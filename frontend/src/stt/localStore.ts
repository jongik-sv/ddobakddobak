/**
 * localStore — 오프라인(로컬) 회의의 진실원천(source of truth) 영속 계층.
 *
 * tauri-plugin-fs(JSON/JSONL/WAV)로 app_local_data_dir 아래 회의별 디렉터리에 저장한다.
 *
 * 레이아웃:
 *   app_local_data_dir/local-meetings/<localId>/
 *     meta.json              LocalMeetingMeta
 *     segments.jsonl         append-only TranscriptFinalData 행(크래시 내성)
 *     audio/<seq>.wav        세그먼트 PCM16 16k mono(opt-in 업로드/재생용)
 *
 * 설계: docs/superpowers/specs/2026-06-01-ondevice-stt-local-mode-design.md §4.1.
 * 모든 fs 호출은 절대경로를 사용한다(baseDir 옵션 미사용 — 경로 의미 단순화).
 */
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { appLocalDataDir, join } from '@tauri-apps/api/path'

import type { TranscriptFinalData } from '../channels/transcription'

/** 로컬 회의 메타. created_at은 ISO 문자열. serverId는 프로모트(업로드) 후 채워짐. */
export interface LocalMeetingMeta {
  localId: string
  title: string
  lang: string
  created_at: string
  status: 'recording' | 'completed'
  serverId?: number
  pendingSync: boolean
}

const ROOT_SUBDIR = 'local-meetings'

/** app_local_data_dir/local-meetings */
async function rootDir(): Promise<string> {
  return join(await appLocalDataDir(), ROOT_SUBDIR)
}

/** app_local_data_dir/local-meetings/<localId> */
async function meetingDir(localId: string): Promise<string> {
  return join(await rootDir(), localId)
}

async function metaPath(localId: string): Promise<string> {
  return join(await meetingDir(localId), 'meta.json')
}

async function segmentsPath(localId: string): Promise<string> {
  return join(await meetingDir(localId), 'segments.jsonl')
}

async function audioDir(localId: string): Promise<string> {
  return join(await meetingDir(localId), 'audio')
}

async function readMeta(localId: string): Promise<LocalMeetingMeta> {
  const raw = await readTextFile(await metaPath(localId))
  return JSON.parse(raw) as LocalMeetingMeta
}

async function writeMeta(meta: LocalMeetingMeta): Promise<void> {
  await writeTextFile(await metaPath(meta.localId), JSON.stringify(meta))
}

/**
 * 새 로컬 회의 생성. localId='local-'+crypto.randomUUID(). meta.json + audio/ 디렉터리 기록.
 */
export async function createLocal(input: {
  title: string
  lang: string
}): Promise<string> {
  const localId = `local-${crypto.randomUUID()}`
  const dir = await meetingDir(localId)
  await mkdir(dir, { recursive: true })
  // audio 디렉터리 미리 생성(첫 appendAudio 전에도 존재).
  await mkdir(await audioDir(localId), { recursive: true })

  const meta: LocalMeetingMeta = {
    localId,
    title: input.title,
    lang: input.lang,
    created_at: new Date().toISOString(),
    status: 'recording',
    pendingSync: false,
  }
  await writeMeta(meta)
  return localId
}

/**
 * 세그먼트 한 건을 segments.jsonl에 한 줄 append(크래시 내성 — 덮어쓰기 아님).
 */
export async function appendSegment(
  localId: string,
  seg: TranscriptFinalData,
): Promise<void> {
  const line = JSON.stringify(seg) + '\n'
  await writeTextFile(await segmentsPath(localId), line, { append: true })
}

/**
 * 세그먼트 PCM16(16k mono)을 WAV로 래핑해 audio/<seq>.wav에 기록(opt-in 업로드/재생용).
 */
export async function appendAudio(
  localId: string,
  seq: number,
  pcm: Int16Array,
): Promise<void> {
  const wav = pcm16ToWav(pcm)
  const path = await join(await audioDir(localId), `${seq}.wav`)
  await writeFile(path, wav)
}

/**
 * 메타 + 세그먼트 전체를 읽는다. segments.jsonl의 마지막 줄이 torn write(부분 기록)면
 * 그 줄만 버리고 나머지는 보존한다(크래시 내성).
 */
export async function getLocal(
  localId: string,
): Promise<{ meta: LocalMeetingMeta; segments: TranscriptFinalData[] }> {
  const meta = await readMeta(localId)
  let segments: TranscriptFinalData[] = []
  const segPath = await segmentsPath(localId)
  if (await exists(segPath)) {
    const raw = await readTextFile(segPath)
    segments = parseJsonl(raw)
  }
  return { meta, segments }
}

/** torn-write 내성 JSONL 파서: 파싱 실패한 줄(보통 마지막 부분 기록)은 건너뛴다. */
function parseJsonl(raw: string): TranscriptFinalData[] {
  const out: TranscriptFinalData[] = []
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as TranscriptFinalData)
    } catch {
      // 부분 기록된(깨진) 줄 — 버린다. 온전한 줄은 이미 out에 있음.
    }
  }
  return out
}

/** serverId 기록 + pendingSync 해제(프로모트 완료 마킹). */
export async function setServerId(
  localId: string,
  serverId: number,
): Promise<void> {
  const meta = await readMeta(localId)
  meta.serverId = serverId
  meta.pendingSync = false
  await writeMeta(meta)
}

/** pendingSync 플래그 토글. */
export async function markPendingSync(
  localId: string,
  pending: boolean,
): Promise<void> {
  const meta = await readMeta(localId)
  meta.pendingSync = pending
  await writeMeta(meta)
}

/** status 갱신(예: 회의 종료 시 'completed'). */
export async function setStatus(
  localId: string,
  status: LocalMeetingMeta['status'],
): Promise<void> {
  const meta = await readMeta(localId)
  meta.status = status
  await writeMeta(meta)
}

/** 모든 로컬 회의 메타를 created_at 오름차순으로 반환. 루트 없으면 빈 배열. */
export async function listLocal(): Promise<LocalMeetingMeta[]> {
  const root = await rootDir()
  if (!(await exists(root))) return []
  const entries = await readDir(root)
  const metas: LocalMeetingMeta[] = []
  for (const e of entries) {
    if (!e.isDirectory) continue
    try {
      metas.push(await readMeta(e.name))
    } catch {
      // meta.json 없는 디렉터리(부분 생성 등) — 무시.
    }
  }
  metas.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return metas
}

/** 회의 디렉터리/파일 전체 제거. 없으면 no-op(throw 안 함). */
export async function deleteLocal(localId: string): Promise<void> {
  const dir = await meetingDir(localId)
  if (!(await exists(dir))) return
  await remove(dir, { recursive: true })
}

/**
 * PCM16(16k mono) → 44바이트 캐논 WAV 헤더 + little-endian 본문.
 * Int16Array 뷰(byteOffset != 0)도 올바르게 직렬화한다.
 */
export function pcm16ToWav(pcm: Int16Array): Uint8Array {
  const sampleRate = 16000
  const numChannels = 1
  const bitsPerSample = 16
  const dataSize = pcm.length * 2
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign

  const out = new Uint8Array(44 + dataSize)
  const view = new DataView(out.buffer)

  const writeAscii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i)
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  // 본문: 각 샘플을 little-endian으로 기록. pcm이 뷰일 수 있으므로 인덱스 접근.
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(44 + i * 2, pcm[i], true)
  }

  return out
}

/**
 * localExport — 오프라인(로컬) 회의 전사/오디오 내보내기.
 *
 * 서버 결합 없이 localStore의 진실원천(meta + segments + 오디오)을 텍스트/마크다운/
 * mp3 파일로 저장한다. 저장은 lib/download(브라우저 anchor 또는 Tauri save 다이얼로그)를
 * 재사용한다 — capabilities는 기존 다운로드 경로에서 이미 충족.
 *
 * 오디오는 mp3(Rust libmp3lame, 서버와 동일 포맷)로 내보낸다. Android 전용 인코더라
 * 비-Android/실패 시 병합 WAV로 폴백.
 */
import type { LocalMeetingMeta } from '../stt/localStore'
import { mergeLocalAudio, encodeMeetingMp3 } from '../stt/localStore'
import type { TranscriptFinalData } from '../channels/transcription'
import { downloadText, downloadBlob } from './download'

export type ExportFormat = 'txt' | 'md'

/** ms → mm:ss (1시간 넘어도 분 누적, 내보내기 가독용). */
function fmtTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 세그먼트 content를 줄바꿈으로 이어붙인 평문. */
export function transcriptToText(_meta: LocalMeetingMeta, segments: TranscriptFinalData[]): string {
  return segments.map((s) => s.content).join('\n')
}

/** `[mm:ss] content` 형식의 마크다운(제목 헤더 + 타임스탬프 라인). */
export function transcriptToMarkdown(meta: LocalMeetingMeta, segments: TranscriptFinalData[]): string {
  const header = `# ${meta.title}\n`
  const lines = segments.map((s) => `[${fmtTimestamp(s.started_at_ms)}] ${s.content}`)
  return `${header}\n${lines.join('\n')}\n`
}

/** 전사를 txt/md 파일로 저장. 파일명 기본 = `${title}.${fmt}`. */
export async function exportTranscript(
  meta: LocalMeetingMeta,
  segments: TranscriptFinalData[],
  fmt: ExportFormat,
): Promise<void> {
  const content = fmt === 'md' ? transcriptToMarkdown(meta, segments) : transcriptToText(meta, segments)
  const mime = fmt === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
  await downloadText(content, `${meta.title}.${fmt}`, mime)
}

/**
 * 회의 오디오를 mp3로 저장(Android libmp3lame). 인코더 미가용/실패 시 병합 WAV로 폴백.
 * 오디오 세그먼트가 전혀 없으면 no-op.
 */
export async function exportAudio(localId: string, meta: LocalMeetingMeta): Promise<void> {
  const mp3 = await encodeMeetingMp3(localId)
  if (mp3) {
    await downloadBlob(new Blob([mp3], { type: 'audio/mpeg' }), `${meta.title}.mp3`)
    return
  }
  // 폴백: 병합 WAV.
  const merged = await mergeLocalAudio(localId)
  if (!merged) return
  await downloadBlob(new Blob([merged.bytes], { type: 'audio/wav' }), `${meta.title}.wav`)
}

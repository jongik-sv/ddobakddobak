/**
 * syncQueue — 로컬 회의 단방향 프로모트 큐 (opt-in 업로드)
 *
 * 설계: docs/superpowers/specs/2026-06-01-ondevice-stt-local-mode-design.md §4.4
 *
 * 단방향 프로모트: 서버 카피는 로컬에서 태어난다 → 양방향 충돌이 없다.
 * 멱등키 = (serverId, sequence_number) — 서버 측 유니크/upsert(Task 9)가 중복 전송을 흡수한다.
 * 따라서 flush는 보유한 모든 세그먼트를 전송해도 안전하다(서버 dedupe). 부분전송 watermark 불필요.
 *
 * 큐 영속은 localStore meta의 pendingSync 플래그로 표현한다:
 *   enqueue        → markPendingSync(localId, true)
 *   flush 성공     → markPendingSync(localId, false)   (setServerId도 부수효과로 해제하지만,
 *                                                       이미 serverId가 있던 경로를 위해 명시 호출)
 *   flush 실패     → pendingSync 유지(다음 기회 재시도 — 마킹을 건드리지 않는다)
 *
 * 이 모듈은 신규 파일만 생성하며 localStore / meetings API는 import만 한다(통합은 메인스레드).
 *
 * 오디오 업로드는 v1 deferred: localStore가 audio 리더(예: readAudio(localId)→blobs)를
 * 노출하지 않는다(현재 audio는 write-only: appendAudio/pcm16ToWav). transcript 프로모트만 구현.
 */

import {
  getLocal,
  setServerId,
  markPendingSync,
  listLocal,
} from './localStore'
import {
  createMeeting,
  bulkCreateTranscripts,
  type BulkTranscriptItem,
} from '../api/meetings'

export interface FlushResult {
  ok: boolean
  serverId?: number
}

/**
 * enqueue — 로컬 회의를 미동기(pendingSync) 상태로 마킹한다.
 * 실제 데이터는 localStore가 진실원천이므로 여기서는 플래그만 세운다.
 */
export function enqueue(localId: string): void {
  void markPendingSync(localId, true)
}

/**
 * flush — 단일 로컬 회의를 서버로 프로모트한다.
 *
 * 1. meta.serverId 없으면 createMeeting({title}) → setServerId(localId, serverId)
 * 2. bulkCreateTranscripts(serverId, items) — 보유한 모든 세그먼트(서버가 멱등 dedupe)
 * 3. 성공 → markPendingSync(localId, false), { ok:true, serverId }
 *    실패 → pendingSync 유지(마킹 안 건드림), { ok:false }
 *
 * getLocal은 회의가 없으면 reject한다(localStore 계약) → try/catch가 흡수.
 */
export async function flush(localId: string): Promise<FlushResult> {
  try {
    const { meta, segments } = await getLocal(localId)

    // 1. serverId 확보(없으면 회의 생성 후 매핑)
    let serverId = meta.serverId
    if (serverId == null) {
      const meeting = await createMeeting({ title: meta.title })
      serverId = meeting.id
      await setServerId(localId, serverId)
    }

    // 2. transcript 일괄 전송 — (serverId, sequence_number) 멱등키로 서버가 중복 흡수.
    //    TranscriptFinalData → BulkTranscriptItem 매핑(서버는 id/applied/created_at을 재발급).
    const items: BulkTranscriptItem[] = segments.map((s) => ({
      content: s.content,
      speaker_label: s.speaker_label,
      started_at_ms: s.started_at_ms,
      ended_at_ms: s.ended_at_ms,
      sequence_number: s.sequence_number,
      ...(s.audio_source ? { audio_source: s.audio_source } : {}),
    }))
    await bulkCreateTranscripts(serverId, items)

    // 3. 성공 → pendingSync 클리어
    await markPendingSync(localId, false)
    return { ok: true, serverId }
  } catch {
    // 실패 → pendingSync 유지(다음 트리거에 재시도). 마킹을 건드리지 않는다.
    return { ok: false }
  }
}

/**
 * flushAll — pendingSync=true 인 로컬 회의 전부 flush 시도.
 * 트리거: probeUrl 복귀 / opt-in 토글 ON / 앱 재개.
 * 개별 실패는 격리(한 건 실패가 나머지를 막지 않음 — flush가 자체 try/catch).
 *
 * listLocal() 은 meta 배열을 반환한다고 가정(localStore 계약; {localId, pendingSync, ...}).
 */
export async function flushAll(): Promise<void> {
  const metas = await listLocal()
  const pending = metas.filter((m) => m.pendingSync === true)
  for (const m of pending) {
    await flush(m.localId)
  }
}

import type { RedactTranscriptsResponse } from '../api/meetings'

/** applyLocalRedaction이 필요로 하는 부수효과. 호출부(MeetingPage)가 자기 클로저 값을 주입한다. */
export interface LocalRedactionDeps {
  /** 페이지의 transcripts 배열과 store를 서버 최신값으로 다시 채운다. */
  reloadTranscripts: () => Promise<void>
  /** 오디오 버전 토큰을 올려 useAudioPlayer가 새 파일을 받게 한다. */
  markAudioChanged: () => void
  /** 사용자 안내(토스트). */
  notify: (message: string, durationMs?: number) => void
}

/**
 * 절단 성공 후 로컬 화면 반영. MeetingPage 밖의 순수 함수로 둔다 — 내부 클로저로 두면
 * markAudioChanged 호출을 자동 검증할 방법이 없는데, 그건 절단한 본인 화면이 옛 오디오
 * (= 기밀)를 계속 재생하지 않게 하는 유일한 장치다(MeetingPage는 전사 채널 미구독이라
 * 원격 경로가 대신해 주지 않는다).
 *
 * 재조회를 쓰는 이유: 절단은 남은 행 전부의 ms를 "클램프된 오디오 경계" 기준 누적 delta로
 * 당긴다(TranscriptRedactionPlan). 그 규칙을 TS로 옮겨 적으면 두 구현이 갈라지는 순간
 * 전사 타임라인이 오디오와 조용히 어긋난다. 재조회 1회가 훨씬 싸고 authoritative하다.
 */
export async function applyLocalRedaction(
  deps: LocalRedactionDeps,
  result: RedactTranscriptsResponse,
): Promise<void> {
  // ⚠️ 오디오 토큰을 **먼저** 올린다. 재조회 뒤에 두면 재조회가 실패했을 때 토큰이 영영
  // 안 올라가고, 그러면 플레이어가 절단 전 기밀 오디오를 계속 재생한다.
  deps.markAudioChanged()

  if (result.summaries_destroyed) {
    // 자동 재요약은 걸지 않는다(설계 §절단 후) — LLM 비용이 들고 사용자가 원하지 않을 수 있다.
    deps.notify('회의록이 삭제되었습니다. 다시 생성하세요.', 6000)
  }
  if (result.backup_retained) {
    deps.notify('절단 전 오디오 백업이 서버에 남았습니다. 최대 1시간 내 자동 정리됩니다.', 8000)
  }

  await deps.reloadTranscripts()
}

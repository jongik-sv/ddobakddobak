// MeetingLivePage 마운트/복귀 시 이 회의의 베이스라인(전사+요약)을 DB에서 어떻게 로드할지 결정.
//
// 배경: 라이브 세션(RecordingHost의 영속 RecordingSession)과 뷰어가 전역 transcriptStore를
// 공유한다. 녹음 중 다른 화면(특히 뷰어)을 들렀다 오면 그 화면 cleanup이 store를 reset → 공백.
// 게다가 영속 세션은 reset 이후에도 "신규" 발화만 스트리밍하므로, 과거 전사·요약은 DB에서
// 다시 불러오지 않으면 영영 복원되지 않는다(라이브가 finals를 다시 채워도 히스토리는 빠짐).
//
// 그래서:
//  - finals: 녹음 중 이 회의로 복귀하면 "항상" DB와 union(라이브 신규 보존 + 히스토리 복원).
//            emptiness로 막지 않는다 — 신규 발화가 한 건이라도 오면 비어있지 않아 게이트가 닫힌다.
//  - summary(회의록): 비었을 때만 로드. 라이브 실시간 요약(meeting_notes_update)이 이미 채웠으면
//            옛 DB 요약으로 덮지 않는다.
//  - reset: idle(녹음 비활성)일 때만. 녹음 중엔 라이브 상태를 건드리지 않는다.
export function planLiveBaselineLoad(params: {
  activeMeetingId: number | null
  meetingId: number
  notesEmpty: boolean
}): { loadFinals: boolean; loadSummary: boolean; reset: boolean } {
  const { activeMeetingId, meetingId, notesEmpty } = params

  // idle: 기존 동작 — 깨끗이 reset 후 전사+요약 로드.
  if (activeMeetingId === null) return { loadFinals: true, loadSummary: true, reset: true }

  // 녹음 중 이 회의로 복귀: 히스토리 복원(finals는 항상 union, 요약은 비었을 때만).
  if (activeMeetingId === meetingId) return { loadFinals: true, loadSummary: notesEmpty, reset: false }

  // 다른 회의 녹음 중: 공유 store는 그 세션 소유 → 건드리지 않음.
  return { loadFinals: false, loadSummary: false, reset: false }
}

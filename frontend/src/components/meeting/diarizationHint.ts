// "화자분리가 완료되었습니다 — 이름 지정 후 회의록 재생성" 안내문을 띄울지 결정한다.
// 핵심: 화자분리가 활성이어도 실제로 서로 다른 화자(distinct speaker_label)가 2명 이상
// 나뉘었을 때만 띄운다. 전사가 전부 같은 라벨이면(분리 안 됨) 거짓 "완료" 표시를 막는다.
// distinct는 speaker_label 기준 — speaker_name은 사용자 지정 이름이라 보통 null이므로 쓰지 않는다.
export function shouldShowDiarizationHint(params: {
  diarizationEnabled: boolean
  finals: { speaker_label: string }[]
  meetingNotes: string | null
  isSummarizing: boolean
}): boolean {
  const { diarizationEnabled, finals, meetingNotes, isSummarizing } = params
  const distinctSpeakers = new Set(finals.map((f) => f.speaker_label)).size
  return (
    diarizationEnabled &&
    distinctSpeakers > 1 &&
    (meetingNotes === null || meetingNotes === '') &&
    !isSummarizing
  )
}

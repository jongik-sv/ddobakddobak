/**
 * 텍스트 콘텐츠를 .md 파일로 다운로드한다.
 * @param content - Markdown 텍스트
 * @param filename - 저장할 파일명 (예: meeting-42-2026-03-25.md)
 */
export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * 회의 ID와 날짜로 표준 파일명을 생성한다.
 * 형식: meeting-{id}-{YYYY-MM-DD}.md
 * @param meetingId - 회의 ID
 * @param date - ISO 8601 날짜 문자열 또는 Date 객체 (기본: 오늘)
 */
export function buildMarkdownFilename(meetingId: number, date?: string | Date): string {
  const d = date ? new Date(date) : new Date()
  const dateStr = d.toISOString().slice(0, 10) // YYYY-MM-DD
  return `meeting-${meetingId}-${dateStr}.md`
}

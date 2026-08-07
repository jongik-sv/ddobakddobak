import { downloadText } from './download'

/**
 * 텍스트 콘텐츠를 .md 파일로 다운로드한다.
 * @param content - Markdown 텍스트
 * @param filename - 저장할 파일명 (예: meeting-42-2026-03-25.md)
 */
export async function downloadMarkdown(content: string, filename: string): Promise<void> {
  await downloadText(content, filename, 'text/markdown;charset=utf-8')
}

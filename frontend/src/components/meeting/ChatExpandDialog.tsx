import { useState } from 'react'
import { Download } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { ChatMarkdown } from './ChatMarkdown'
import { downloadChatAnswer } from '../../lib/chatExport'

// ChatMarkdown 루트가 text-sm/leading-relaxed/h*/code/pre/table에 크기를 직접 박아 넣으므로
// (react-markdown 커스텀 컴포넌트, 클래스가 엘리먼트에 직접 붙음) 부모에서 상속으로는 확대할 수
// 없다. ChatMarkdown.tsx는 이 작업 범위 밖(다른 파일 수정 금지)이라, 이 컴포넌트 전용 클래스로
// 스코프를 좁힌 후 해당 Tailwind 클래스들을 셀렉터 특이도로 덮어쓴다(.scope 조합 클래스이므로
// 항상 순수 유틸리티 클래스보다 특이도가 높아 순서와 무관하게 이긴다).
const ENLARGE_CSS = `
  .chat-expand-answer .text-sm.leading-relaxed { font-size: 1.0625rem; line-height: 1.9; }
  .chat-expand-answer h1.text-base { font-size: 1.375rem; }
  .chat-expand-answer h2.text-sm, .chat-expand-answer h3.text-sm { font-size: 1.1875rem; }
  .chat-expand-answer code.text-xs { font-size: 0.9375rem; }
  .chat-expand-answer pre.text-xs { font-size: 0.9375rem; }
  .chat-expand-answer table.text-xs { font-size: 0.9375rem; }
`

export function ChatExpandDialog({
  content,
  onSeek,
  onSeekMeeting,
  onClose,
}: {
  content: string
  onSeek?: (ms: number) => void
  onSeekMeeting?: (meetingId: number, ms: number) => void
  onClose: () => void
}) {
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      await downloadChatAnswer(content)
    } catch {
      setSaveError('저장에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      onClose={onClose}
      closeOnBackdrop
      ariaLabel="AI 답변 확대 보기"
      className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl bg-card shadow-2xl border border-border flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold text-foreground">AI 답변</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            aria-label={isSaving ? 'MD 저장 중...' : 'MD 저장'}
            title="MD 저장"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span>{isSaving ? '저장 중...' : 'MD 저장'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
          >
            닫기 <span aria-hidden="true">✕</span>
          </button>
        </div>
      </div>
      {saveError && (
        <p className="px-5 pt-2 text-xs text-red-500 shrink-0">{saveError}</p>
      )}
      <div className="chat-expand-answer flex-1 overflow-y-auto px-5 py-4">
        <style>{ENLARGE_CSS}</style>
        <ChatMarkdown content={content} onSeek={onSeek} onSeekMeeting={onSeekMeeting} />
      </div>
    </Dialog>
  )
}

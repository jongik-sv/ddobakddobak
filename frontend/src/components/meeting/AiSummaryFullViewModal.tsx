import { X } from 'lucide-react'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { BREAKPOINTS } from '../../config'
import { Dialog } from '../ui/Dialog'
import { AiSummaryPanel } from './AiSummaryPanel'

const CONTAINER_DESKTOP =
  'relative w-full max-w-7xl h-[92vh] max-h-[92vh] rounded-xl bg-white shadow-2xl border border-gray-100 flex flex-col mx-4'
const CONTAINER_MOBILE = 'fixed inset-0 w-full h-dvh bg-white flex flex-col'

const CLOSE_BTN =
  'p-1.5 min-h-[44px] flex items-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors'

interface AiSummaryFullViewModalProps {
  meetingId: number
  /** 모달 안에서 편집 허용 여부. 기본 false(읽기전용) — 동시 편집/저장 데이터손실 방지. */
  editable?: boolean
  onClose: () => void
}

/**
 * AI 회의록을 큰 모달로 "한눈에 크게" 보여준다(읽기 목적).
 * 같은 AiSummaryPanel을 그대로 마운트하되 hideExpand로 확대 버튼을 숨겨 재귀를 막는다.
 * 크기: 데스크톱 대형 카드 / 모바일 풀스크린(SettingsModal 패턴).
 */
export function AiSummaryFullViewModal({
  meetingId,
  editable = false,
  onClose,
}: AiSummaryFullViewModalProps) {
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)

  return (
    <Dialog
      onClose={onClose}
      ariaLabel="AI 회의록 전체보기"
      closeOnBackdrop
      className={isDesktop ? CONTAINER_DESKTOP : CONTAINER_MOBILE}
    >
      <div data-testid="ai-summary-fullview" className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">AI 회의록</h2>
          <button onClick={onClose} className={CLOSE_BTN} aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <AiSummaryPanel
            meetingId={meetingId}
            editable={editable}
            isRecording={false}
            hideExpand
          />
        </div>
      </div>
    </Dialog>
  )
}

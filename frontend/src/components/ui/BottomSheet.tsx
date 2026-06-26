import { useCallback, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  커스텀 훅: ESC 키 닫기                                            */
/* ------------------------------------------------------------------ */
function useEscapeKey(enabled: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, onEscape])
}

/* ------------------------------------------------------------------ */
/*  커스텀 훅: 배경 스크롤 잠금                                       */
/* ------------------------------------------------------------------ */
function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    document.body.style.overflow = locked ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [locked])
}

/* ------------------------------------------------------------------ */
/*  BottomSheet 컴포넌트                                              */
/* ------------------------------------------------------------------ */
interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

const SHEET_BASE_CLASS =
  'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-card max-h-[80vh] animate-slide-in-bottom'

export function BottomSheet({ open, onClose, title, children, className }: BottomSheetProps) {
  const stableOnClose = useCallback(() => onClose(), [onClose])

  useEscapeKey(open, stableOnClose)
  useBodyScrollLock(open)

  if (!open) return null

  const sheetClass = className ? `${SHEET_BASE_CLASS} ${className}` : SHEET_BASE_CLASS

  return createPortal(
    <>
      {/* 백드롭 */}
      <div
        data-testid="bottom-sheet-backdrop"
        className="fixed inset-0 z-50 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 시트 컨테이너 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={sheetClass}
      >
        {/* 핸들 바 */}
        <div className="flex justify-center pt-3 pb-1" data-testid="bottom-sheet-handle">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        {/* 헤더 (조건부) */}
        {title && (
          <div className="flex items-center justify-between px-4 py-2">
            <h2 className="text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* 콘텐츠 영역 */}
        <div
          data-testid="bottom-sheet-content"
          className="overflow-y-auto overscroll-contain flex-1 p-4 pb-safe"
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  )
}

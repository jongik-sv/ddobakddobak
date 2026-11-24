import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { BREAKPOINTS } from '../../config'
import SettingsContent from './SettingsContent'
import { useResizableModal } from './useResizableModal'

// 크기는 useResizableModal 이 inline style 로 고정(탭 전환·콘텐츠에 따라 변하지 않음).
const CONTAINER_DESKTOP =
  'relative max-w-3xl rounded-xl bg-card shadow-2xl border border-border flex flex-col overflow-hidden'
const CONTAINER_MOBILE = 'fixed inset-0 w-full h-dvh bg-card flex flex-col'

const CLOSE_BTN =
  'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'

interface Props {
  /** 오프라인(서버 0) 진입 — SettingsContent로 그대로 전달해 클라전용 패널만 렌더. */
  offline?: boolean
}

export default function SettingsModal({ offline }: Props = {}) {
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)
  const { size, dragging, cornerProps, rightProps, bottomProps } = useResizableModal()

  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [settingsOpen, closeSettings])

  if (!settingsOpen) return null

  const closeButton = (
    <button onClick={closeSettings} className={CLOSE_BTN} aria-label="닫기">
      <X className="w-5 h-5" />
    </button>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={isDesktop ? CONTAINER_DESKTOP : CONTAINER_MOBILE}
        style={isDesktop ? { width: size.w, height: size.h, maxWidth: 'none' } : undefined}
      >
        {/* 헤더: 모바일=좌측 X, 데스크톱=우측 X */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          {!isDesktop && closeButton}
          <h2 className="text-lg font-semibold text-foreground">설정</h2>
          {isDesktop && closeButton}
        </div>

        {/* 스크롤 가능 본문 */}
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <SettingsContent offline={offline} />
        </div>

        {isDesktop && (
          <>
            <div
              data-testid="resize-right"
              aria-hidden="true"
              className="absolute top-0 right-0 bottom-3 w-1.5 cursor-ew-resize touch-none"
              {...rightProps}
            />
            <div
              data-testid="resize-bottom"
              aria-hidden="true"
              className="absolute left-0 right-3 bottom-0 h-1.5 cursor-ns-resize touch-none"
              {...bottomProps}
            />
            <div
              data-testid="resize-handle"
              role="separator"
              aria-label="설정창 크기 조절 (더블클릭: 기본 크기)"
              title="드래그: 크기 조절 / 더블클릭: 기본 크기"
              className={`absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize touch-none flex items-end justify-end p-0.5 text-muted-foreground hover:text-foreground ${dragging ? 'text-foreground' : ''}`}
              {...cornerProps}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

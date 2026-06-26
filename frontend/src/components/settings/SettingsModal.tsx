import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { BREAKPOINTS } from '../../config'
import SettingsContent from './SettingsContent'

const CONTAINER_DESKTOP =
  'relative w-full max-w-3xl max-h-[90vh] rounded-xl bg-card shadow-2xl border border-border flex flex-col mx-4'
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
      <div className={isDesktop ? CONTAINER_DESKTOP : CONTAINER_MOBILE}>
        {/* 헤더: 모바일=좌측 X, 데스크톱=우측 X */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          {!isDesktop && closeButton}
          <h2 className="text-lg font-semibold text-foreground">설정</h2>
          {isDesktop && closeButton}
        </div>

        {/* 스크롤 가능 본문 */}
        <div className="flex-1 overflow-y-auto p-6">
          <SettingsContent offline={offline} />
        </div>
      </div>
    </div>
  )
}

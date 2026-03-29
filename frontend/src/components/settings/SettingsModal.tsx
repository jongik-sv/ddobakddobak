import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import SettingsContent from './SettingsContent'

export default function SettingsModal() {
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const closeSettings = useUiStore((s) => s.closeSettings)

  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [settingsOpen, closeSettings])

  if (!settingsOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) closeSettings() }}
    >
      <div className="relative w-full max-w-3xl max-h-[90vh] rounded-xl bg-white shadow-2xl border border-gray-100 flex flex-col mx-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">설정</h2>
          <button
            onClick={closeSettings}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* 스크롤 가능 본문 */}
        <div className="flex-1 overflow-y-auto p-6">
          <SettingsContent />
        </div>
      </div>
    </div>
  )
}

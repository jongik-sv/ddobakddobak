import { useEffect } from 'react'
import Sidebar from './Sidebar'

interface MobileSidebarOverlayProps {
  onClose: () => void
}

export default function MobileSidebarOverlay({ onClose }: MobileSidebarOverlayProps) {
  // Escape key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // Prevent background scroll while overlay is open
  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="사이드바 메뉴"
    >
      {/* 백드롭 */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 사이드바 패널 */}
      <div
        className="relative h-full w-72 max-w-[80vw] bg-sidebar animate-slide-in-left"
        onClick={(e) => e.stopPropagation()}
      >
        <Sidebar />
      </div>
    </div>
  )
}

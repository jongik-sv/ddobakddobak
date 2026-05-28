import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface DialogProps {
  onClose: () => void
  children: ReactNode
  /** 카드 컨테이너 클래스 (미지정 시 기본 카드 스타일) */
  className?: string
  /** 백드롭 배경 클래스 (미지정 시 'bg-black/40') */
  backdropClassName?: string
  /** 백드롭 클릭으로 닫기 허용 (기본 true) */
  closeOnBackdrop?: boolean
  /** Esc 키로 닫기 허용 (기본 true) */
  closeOnEsc?: boolean
  ariaLabel?: string
}

const DEFAULT_CARD = 'w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-100'
const BACKDROP_BASE = 'fixed inset-0 z-50 flex items-center justify-center'

/**
 * 모달 다이얼로그 공통 셸. 백드롭 + 중앙 정렬 카드 + Esc 닫기 + 배경 스크롤 잠금 + 포털 렌더.
 * 내부 마크업(헤더/본문/버튼)은 children으로 그대로 전달한다.
 */
export function Dialog({
  onClose,
  children,
  className,
  backdropClassName = 'bg-black/40',
  closeOnBackdrop = true,
  closeOnEsc = true,
  ariaLabel,
}: DialogProps) {
  useEffect(() => {
    if (!closeOnEsc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, closeOnEsc])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className={`${BACKDROP_BASE} ${backdropClassName}`}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div className={className ?? DEFAULT_CARD}>{children}</div>
    </div>,
    document.body,
  )
}

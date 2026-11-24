import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export const SIZE_STORAGE_KEY = 'ddobak.settingsModal.size'
export const MIN_W = 560
export const MIN_H = 420
export const MARGIN = 32
const DEFAULT_W = 960
const DEFAULT_H = 760

export interface ModalSize {
  w: number
  h: number
}

type Axis = 'both' | 'x' | 'y'

function viewport(): ModalSize {
  return { w: window.innerWidth, h: window.innerHeight }
}

/** 뷰포트 기준 기본 크기. */
export function defaultSize(vp: ModalSize = viewport()): ModalSize {
  return {
    w: Math.min(DEFAULT_W, vp.w - MARGIN),
    h: Math.min(DEFAULT_H, Math.round(vp.h * 0.88), vp.h - MARGIN),
  }
}

/** 최소(560x420) ~ 최대(뷰포트-32) 로 제한. 뷰포트가 최소보다 작으면 최대가 우선. */
export function clampSize(s: ModalSize, vp: ModalSize = viewport()): ModalSize {
  const maxW = Math.max(0, vp.w - MARGIN)
  const maxH = Math.max(0, vp.h - MARGIN)
  return {
    w: Math.round(Math.min(maxW, Math.max(MIN_W, s.w))),
    h: Math.round(Math.min(maxH, Math.max(MIN_H, s.h))),
  }
}

function readStored(): ModalSize | null {
  try {
    const raw = localStorage.getItem(SIZE_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<ModalSize> | null
    if (!v || !Number.isFinite(v.w) || !Number.isFinite(v.h)) return null
    return { w: v.w as number, h: v.h as number }
  } catch {
    return null
  }
}

function writeStored(s: ModalSize | null) {
  try {
    if (s) localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(s))
    else localStorage.removeItem(SIZE_STORAGE_KEY)
  } catch {
    /* 저장 불가 환경 무시 */
  }
}

/**
 * 설정 모달 크기 상태 + 드래그 리사이즈.
 * 모달은 화면 중앙 고정이므로 드래그 변화량의 2배를 반영해 포인터가 모서리를 따라가게 한다(대칭 확장).
 */
export function useResizableModal() {
  const [vp, setVp] = useState<ModalSize>(viewport)
  const [stored, setStored] = useState<ModalSize | null>(readStored)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; start: ModalSize; axis: Axis } | null>(null)
  const latest = useRef<ModalSize>(defaultSize(vp))

  useEffect(() => {
    const onResize = () => setVp(viewport())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const size = clampSize(stored ?? defaultSize(vp), vp)
  latest.current = size

  const startDrag = useCallback(
    (axis: Axis) => (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== undefined && e.button > 0) return
      e.preventDefault()
      e.stopPropagation()
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId)
      } catch {
        /* 무시 */
      }
      drag.current = { x: e.clientX, y: e.clientY, start: latest.current, axis }
      setDragging(true)
    },
    [],
  )

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const next = {
      w: d.axis === 'y' ? d.start.w : d.start.w + 2 * (e.clientX - d.x),
      h: d.axis === 'x' ? d.start.h : d.start.h + 2 * (e.clientY - d.y),
    }
    setStored(clampSize(next, viewport()))
  }, [])

  const endDrag = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch {
      /* 무시 */
    }
    writeStored(latest.current)
  }, [])

  const reset = useCallback(() => {
    drag.current = null
    setStored(null)
    writeStored(null)
  }, [])

  const handleProps = (axis: Axis) => ({
    onPointerDown: startDrag(axis),
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onDoubleClick: reset,
  })

  return { size, dragging, reset, cornerProps: handleProps('both'), rightProps: handleProps('x'), bottomProps: handleProps('y') }
}

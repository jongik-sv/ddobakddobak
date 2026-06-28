import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Rnd, type RndDragCallback, type RndResizeCallback } from 'react-rnd'
import { X } from 'lucide-react'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { BREAKPOINTS } from '../../config'
import { Dialog } from '../ui/Dialog'
import { AiSummaryPanel } from './AiSummaryPanel'

const CONTAINER_MOBILE = 'fixed inset-0 w-full h-dvh bg-card flex flex-col'

// 데스크톱: 떠 있는 창 카드 룩(헤더 드래그 핸들 + 우하단 리사이즈 그립).
const CARD_DESKTOP =
  'relative flex flex-col h-full min-h-0 rounded-xl bg-card shadow-2xl border border-border overflow-hidden'

const CLOSE_BTN =
  'p-1.5 min-h-[44px] flex items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'

/** 데스크톱 떠 있는 창의 위치·크기. localStorage에 저장해 다음 열람 때 복원한다. */
interface Geometry {
  x: number
  y: number
  width: number
  height: number
}

// v2: 뷰포트를 꽉 채우던 옛 기본값으로 저장된 stale 지오메트리를 무효화한다.
// (옛 기본값은 bounds="window" 하에서 이동 여백이 ~0이라 창이 안 움직였음 → 기존 사용자도 이동 가능한 창을 받도록 키를 올림.)
const STORAGE_KEY = 'ddobak.aiSummaryFullView.geometry.v2'
const MIN_WIDTH = 480
const MIN_HEIGHT = 360

/** 뷰포트 안에서 충분한 이동 여백(bounds="window" 하에서 드래그 가능 거리)을 남긴 기본 창 위치·크기. */
function computeDefaultGeometry(): Geometry {
  const H_MARGIN = 80   // 좌우 각 최소 여백 → 최소 80px 이동 여지
  const V_MARGIN = 100  // 상하 각 최소 여백 → 최소 100px 이동 여지
  const width = Math.max(MIN_WIDTH, Math.min(1600, Math.round(window.innerWidth - H_MARGIN * 2)))
  const height = Math.max(MIN_HEIGHT, Math.round(window.innerHeight - V_MARGIN * 2))
  const x = Math.max(0, Math.round((window.innerWidth - width) / 2))
  const y = Math.max(0, Math.round((window.innerHeight - height) / 2))
  return { x, y, width, height }
}

/**
 * 저장된 창 위치·크기를 읽어 현재 뷰포트 안으로 클램프한다.
 * 화면 밖으로 밀려나 창이 사라지는 stale 좌표를 방지. 없거나 파싱 실패 시 기본값.
 */
function loadGeometry(): Geometry {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0, width: MIN_WIDTH, height: MIN_HEIGHT }
  }
  const fallback = computeDefaultGeometry()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw) as Partial<Geometry>
    if (
      typeof saved.x !== 'number' ||
      typeof saved.y !== 'number' ||
      typeof saved.width !== 'number' ||
      typeof saved.height !== 'number'
    ) {
      return fallback
    }
    // minWidth/minHeight를 보장하면서 현재 뷰포트로 클램프(min을 max로 깔아 최소 크기 강제).
    const width = Math.max(MIN_WIDTH, Math.min(saved.width, window.innerWidth))
    const height = Math.max(MIN_HEIGHT, Math.min(saved.height, window.innerHeight))
    const x = Math.min(Math.max(0, saved.x), Math.max(0, window.innerWidth - width))
    const y = Math.min(Math.max(0, saved.y), Math.max(0, window.innerHeight - height))
    return { x, y, width, height }
  } catch {
    return fallback
  }
}

function saveGeometry(geometry: Geometry) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry))
  } catch {
    // 저장 실패(프라이빗 모드 등)는 무시 — 다음 열람에 기본값으로 폴백.
  }
}

/** 리사이즈 종료/언마운트 시 body의 user-select 잠금을 해제한다(평소엔 본문 텍스트 복사 가능해야 함). */
function restoreBodyUserSelect() {
  document.body.style.userSelect = ''
  ;(document.body.style as { webkitUserSelect?: string }).webkitUserSelect = ''
}

interface AiSummaryFullViewModalProps {
  meetingId: number
  /** 모달 안에서 편집 허용 여부. 기본 false(읽기전용) — 동시 편집/저장 데이터손실 방지. */
  editable?: boolean
  onClose: () => void
}

/**
 * AI 회의록을 크게 보여준다(읽기 목적).
 * 데스크톱: 클릭 통과(투명) 배경 위에 떠 있는 드래그·리사이즈 가능한 창 — 뒤의 전사를 읽고 클릭할 수 있다.
 * 모바일: 풀스크린(기존 Dialog 패턴 유지).
 * 같은 AiSummaryPanel을 마운트하되 hideExpand로 확대 버튼을 숨겨 재귀를 막는다.
 */
export function AiSummaryFullViewModal({
  meetingId,
  editable = false,
  onClose,
}: AiSummaryFullViewModalProps) {
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)
  // default(uncontrolled)로만 전달 — react-rnd는 마운트 시 1회만 읽고 이후 위치는 내부 state로 관리하므로
  // 이 state를 갱신해도 창이 튀지 않는다(영속용으로만 추적).
  const [geometry, setGeometry] = useState<Geometry>(loadGeometry)

  // 데스크톱은 배경이 클릭 통과(백드롭 없음)라 Esc로만 닫는다. 모바일은 Dialog가 Esc를 처리.
  useEffect(() => {
    if (!isDesktop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // 리사이즈 도중 모달이 닫혀도(언마운트) body user-select 잠금이 남지 않도록 정리한다.
    return () => {
      window.removeEventListener('keydown', onKey)
      restoreBodyUserSelect()
    }
  }, [isDesktop, onClose])

  const handleDragStop: RndDragCallback = (_e, d) => {
    setGeometry((prev) => {
      const next = { ...prev, x: d.x, y: d.y }
      saveGeometry(next)
      return next
    })
  }

  const handleResizeStart = () => {
    // 리사이즈 드래그 중 본문 텍스트가 선택되는 것을 막는다(re-resizable는 자체 user-select 훅이 없음).
    document.body.style.userSelect = 'none'
    ;(document.body.style as { webkitUserSelect?: string }).webkitUserSelect = 'none'
    window.getSelection()?.removeAllRanges()
  }

  const handleResizeStop: RndResizeCallback = (_e, _dir, ref, _delta, position) => {
    restoreBodyUserSelect()
    const next: Geometry = {
      x: position.x,
      y: position.y,
      width: ref.offsetWidth,
      height: ref.offsetHeight,
    }
    saveGeometry(next)
    setGeometry(next)
  }

  // 헤더(드래그 핸들)와 본문은 양쪽 경로 공용. 데스크톱에서만 드래그 관련 클래스를 덧붙인다.
  // 데스크톱 전용 testid는 E2E용 — 모바일은 컬럼 래퍼에 ai-summary-fullview 하나만 둔다(중복 방지).
  const header = (
    <div
      data-testid={isDesktop ? 'ai-summary-fullview-header' : undefined}
      className={`flex items-center justify-between px-6 py-4 border-b shrink-0${
        isDesktop ? ' ai-summary-drag-handle cursor-move select-none' : ''
      }`}
    >
      <h2 className="text-lg font-semibold text-foreground">AI 회의록</h2>
      <button
        onClick={onClose}
        className={`${CLOSE_BTN}${isDesktop ? ' ai-summary-no-drag' : ''}`}
        aria-label="닫기"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  )

  const body = (
    <div
      data-testid={isDesktop ? 'ai-summary-fullview' : undefined}
      className="flex-1 min-h-0 flex flex-col overflow-hidden"
    >
      <AiSummaryPanel
        meetingId={meetingId}
        editable={editable}
        isRecording={false}
        hideExpand
      />
    </div>
  )

  // 모바일: 기존 풀스크린 Dialog 경로 그대로(드래그·리사이즈 없음, 배경 스크롤 잠금·Esc는 Dialog가 처리).
  if (!isDesktop) {
    return (
      <Dialog
        onClose={onClose}
        ariaLabel="AI 회의록 전체보기"
        closeOnBackdrop
        className={CONTAINER_MOBILE}
      >
        <div data-testid="ai-summary-fullview" className="flex flex-col h-full min-h-0">
          {header}
          {body}
        </div>
      </Dialog>
    )
  }

  // 데스크톱: 클릭 통과 래퍼(pointer-events-none) + 떠 있는 창(pointer-events-auto).
  // 백드롭이 없어 뒤의 페이지를 그대로 읽고 클릭할 수 있다.
  return createPortal(
    <div className="fixed inset-0 z-50 pointer-events-none">
      <Rnd
        className="pointer-events-auto"
        default={geometry}
        bounds="window"
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        dragHandleClassName="ai-summary-drag-handle"
        cancel=".ai-summary-no-drag"
        onDragStop={handleDragStop}
        onResizeStart={handleResizeStart}
        onResizeStop={handleResizeStop}
      >
        <div
          data-testid="ai-summary-fullview-window"
          role="dialog"
          aria-label="AI 회의록 전체보기"
          className={CARD_DESKTOP}
        >
          {header}
          {body}
          {/* 우하단 리사이즈 가능 힌트(장식). 실제 리사이즈는 react-rnd의 8방향 핸들이 담당. */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-1 right-1 text-muted-foreground/50"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M11 4 L4 11 M11 8 L8 11" />
            </svg>
          </div>
        </div>
      </Rnd>
    </div>,
    document.body,
  )
}

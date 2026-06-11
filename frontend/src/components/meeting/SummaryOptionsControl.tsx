import { useEffect, useRef, useState } from 'react'
import type { Meeting, SummaryVerbosity, UpdateMeetingParams } from '../../api/meetings'
import { Switch } from '../ui/Switch'

export const VERBOSITY_OPTIONS: { value: SummaryVerbosity; label: string; desc: string }[] = [
  { value: 'very_concise', label: '아주 간결', desc: '결정·액션만, 항목당 1문장 (가장 빠름)' },
  { value: 'concise', label: '간결', desc: '항목당 1문장, 표 최소' },
  { value: 'standard', label: '보통', desc: '기본 분량' },
  { value: 'detailed', label: '상세', desc: '맥락·근거 충실, 표 적극 활용' },
  { value: 'very_detailed', label: '아주 상세', desc: '발언 흐름·반론까지 전부 (가장 느림)' },
]

interface SummaryOptionsControlProps {
  meeting: Pick<Meeting, 'summary_verbosity' | 'summary_restructure'>
  /** PATCH 책임은 페이지가 짐 (live=store setMeeting, preview=useMeeting.updateMeetingInfo) */
  onSave: (params: UpdateMeetingParams) => Promise<void>
  disabled?: boolean
}

/**
 * 회의록 압축율(5단계) + 재구조화 여부를 회의 화면/미리보기에서 바로 바꾸는 컨트롤.
 * 터치에서 hover 툴팁이 없으므로, 클릭 popover 안에 옵션별 설명을 인라인으로 보여준다.
 */
export function SummaryOptionsControl({ meeting, onSave, disabled = false }: SummaryOptionsControlProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(false)
  // 팝오버는 fixed 포지셔닝 — absolute 는 패널의 overflow-hidden 조상에 잘린다(좁은 패널 폭에서 옵션 가림)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const verbosity = meeting.summary_verbosity ?? 'standard'
  const restructure = meeting.summary_restructure ?? true
  const verbosityLabel = VERBOSITY_OPTIONS.find((o) => o.value === verbosity)?.label ?? '보통'

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) })
    }
    setSaveError(false)
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onResize() {
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  async function save(params: UpdateMeetingParams) {
    setBusy(true)
    setSaveError(false)
    try {
      await onSave(params)
    } catch (e) {
      console.error('[SummaryOptionsControl] 요약 옵션 저장 실패:', e)
      setSaveError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1 px-2 py-0.5 min-h-[28px] rounded text-[11px] font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
        title="회의록 압축율·재구조화 설정"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
        </svg>
        {verbosityLabel}{restructure ? '' : ' · 증분'}
      </button>

      {open && pos && (
        <div
          role="dialog"
          aria-label="요약 옵션"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-72 max-w-[calc(100vw-16px)] max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg p-3"
        >
          <p className="text-xs font-semibold text-gray-500 mb-1.5">회의록 압축율</p>
          <div role="radiogroup" aria-label="회의록 압축율" className="flex flex-col">
            {VERBOSITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={verbosity === opt.value}
                disabled={busy}
                onClick={() => verbosity !== opt.value && save({ summary_verbosity: opt.value })}
                className={`flex items-start gap-2 px-2 py-1.5 rounded text-left transition-colors disabled:opacity-50 ${
                  verbosity === opt.value ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    verbosity === opt.value ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                />
                <span className="min-w-0">
                  <span className={`block text-xs font-medium ${verbosity === opt.value ? 'text-blue-700' : 'text-gray-800'}`}>
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-gray-500">{opt.desc}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-2 pt-2 border-t border-gray-100">
            <Switch
              checked={restructure}
              disabled={busy}
              onChange={(checked) => save({ summary_restructure: checked })}
              label="지속 재구조화"
            />
            <p className="text-[11px] text-gray-500 mt-0.5 pl-11">
              {restructure
                ? '매 요약마다 전체를 재정리 — 결정이 바뀌면 마지막 내용만 남음'
                : '증분 기록 — 앞 내용은 그대로 두고 시간대별로 뒤에 추가 (빠름)'}
            </p>
            {saveError && (
              <p role="alert" className="text-[11px] text-red-600 mt-1.5">
                저장 실패 — 네트워크 또는 권한을 확인하고 다시 시도하세요
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

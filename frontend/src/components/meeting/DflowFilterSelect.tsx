// D'Flow 전송 상태 필터 옵션 — 데스크톱 select와 모바일 BottomSheet select가 공유한다.
const DFLOW_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'synced', label: "D'Flow 전송됨" },
  { value: 'needs_resync', label: '재전송 필요' },
  { value: 'not_sent', label: '미전송' },
]

interface DflowFilterSelectProps {
  value: string
  onChange: (value: string) => void
  className: string
}

/** D'Flow 전송 상태 필터 select — MeetingsPage 데스크톱 툴바 / 모바일 BottomSheet가 공유(className만 다름). */
export function DflowFilterSelect({ value, onChange, className }: DflowFilterSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="D'Flow 전송 상태"
      className={className}
    >
      {DFLOW_FILTER_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

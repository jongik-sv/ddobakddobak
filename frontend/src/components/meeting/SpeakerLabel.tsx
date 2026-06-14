const SPEAKER_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-green-100 text-green-800',
  'bg-purple-100 text-purple-800',
  'bg-orange-100 text-orange-800',
  'bg-pink-100 text-pink-800',
  'bg-teal-100 text-teal-800',
  'bg-yellow-100 text-yellow-800',
  'bg-red-100 text-red-800',
  'bg-indigo-100 text-indigo-800',
  'bg-cyan-100 text-cyan-800',
]

const SPEAKER_BORDER_COLORS = [
  'border-blue-400',
  'border-green-400',
  'border-purple-400',
  'border-orange-400',
  'border-pink-400',
  'border-teal-400',
  'border-yellow-400',
  'border-red-400',
  'border-indigo-400',
  'border-cyan-400',
]

function speakerIndex(speakerLabel: string): number {
  const match = speakerLabel.match(/(\d+)$/)
  return match ? parseInt(match[1], 10) % SPEAKER_COLORS.length : 0
}

export function speakerColor(speakerLabel: string): string {
  return SPEAKER_COLORS[speakerIndex(speakerLabel)]
}

/** 화자별 왼쪽 띠 border 색 (그룹 구분 강조용) */
export function speakerBorderColor(speakerLabel: string): string {
  return SPEAKER_BORDER_COLORS[speakerIndex(speakerLabel)]
}

interface SpeakerLabelProps {
  speakerLabel: string
  /** 표시 이름. null/undefined면 라벨로 fallback */
  speakerName?: string | null
  /** 칩 크기. 'sm'(기본) 또는 'md'(미리보기 등 크게) */
  size?: 'sm' | 'md'
}

export function SpeakerLabel({ speakerLabel, speakerName, size = 'sm' }: SpeakerLabelProps) {
  const colorClass = speakerColor(speakerLabel)
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'

  return (
    <span
      role="status"
      className={`inline-block rounded font-semibold ${sizeClass} ${colorClass}`}
    >
      {speakerName ?? speakerLabel}
    </span>
  )
}

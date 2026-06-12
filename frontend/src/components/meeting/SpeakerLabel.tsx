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

export function speakerColor(speakerLabel: string): string {
  const match = speakerLabel.match(/(\d+)$/)
  const index = match ? parseInt(match[1], 10) % SPEAKER_COLORS.length : 0
  return SPEAKER_COLORS[index]
}

interface SpeakerLabelProps {
  speakerLabel: string
  /** 표시 이름. null/undefined면 라벨로 fallback */
  speakerName?: string | null
}

export function SpeakerLabel({ speakerLabel, speakerName }: SpeakerLabelProps) {
  const colorClass = speakerColor(speakerLabel)

  return (
    <span
      role="status"
      className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${colorClass}`}
    >
      {speakerName ?? speakerLabel}
    </span>
  )
}

import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export const SPEAKER_COLORS = [
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

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function speakerIndex(speakerLabel: string): number {
  const match = speakerLabel.match(/(\d+)$/)
  if (match) return parseInt(match[1], 10) % SPEAKER_COLORS.length
  const key = speakerLabel.trim()
  if (!key) return 0
  return hashString(key) % SPEAKER_COLORS.length
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
  /** true면 더블클릭으로 인라인 이름 편집 가능 (onRename 필요). 기본 false */
  editable?: boolean
  /** 편집 저장 콜백. trim된 새 이름을 받는다 */
  onRename?: (name: string) => void | Promise<void>
}

export function SpeakerLabel({
  speakerLabel,
  speakerName,
  size = 'sm',
  editable = false,
  onRename,
}: SpeakerLabelProps) {
  const colorClass = speakerColor(speakerLabel)
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'
  const canEdit = editable && !!onRename
  const current = speakerName ?? speakerLabel

  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const cancelRef = useRef(false)

  function startEdit() {
    if (!canEdit) return
    const isCustom = speakerName != null && speakerName !== speakerLabel
    setValue(isCustom ? speakerName : '')
    setEditing(true)
  }

  // onBlur가 유일한 저장 경로 — Enter/Esc는 blur를 유발한다 (이중 저장 방지)
  function commit() {
    setEditing(false)
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
    const name = value.trim()
    if (name && name !== current && onRename) onRename(name)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRef.current = true
      e.currentTarget.blur()
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        placeholder={speakerLabel}
        aria-label="화자 이름 편집"
        className={`inline-block rounded font-semibold border-b border-blue-400 outline-none bg-transparent ${sizeClass} ${colorClass}`}
      />
    )
  }

  return (
    <span
      role="status"
      onDoubleClick={startEdit}
      title={canEdit ? '더블클릭하여 이름 편집' : undefined}
      className={`inline-block rounded font-semibold ${sizeClass} ${colorClass} ${canEdit ? 'cursor-text' : ''}`}
    >
      {current}
    </span>
  )
}

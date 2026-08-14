import { useState } from 'react'
import { formatSize } from '../../lib/formatBytes'

interface AudioFileOrderListProps {
  files: File[]
  onReorder: (next: File[]) => void
  onRemove: (index: number) => void
  disabled?: boolean
}

/** 배열의 두 인덱스를 교환한 새 배열을 반환한다 (원본 불변). */
function swap(files: File[], a: number, b: number): File[] {
  const next = [...files]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

/** 다중 음성파일 업로드 시 병합 순서를 확인·변경하는 리스트.
 *
 * 순서 변경은 HTML5 native drag(데스크탑)와 ▲/▼ 버튼(터치/모바일 웹뷰 폴백)
 * 두 경로를 모두 지원한다 — Tauri 안드로이드 웹뷰는 HTML5 drag가 동작하지 않는다.
 */
export function AudioFileOrderList({ files, onReorder, onRemove, disabled = false }: AudioFileOrderListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const moveUp = (index: number) => {
    if (disabled || index <= 0) return
    onReorder(swap(files, index, index - 1))
  }

  const moveDown = (index: number) => {
    if (disabled || index >= files.length - 1) return
    onReorder(swap(files, index, index + 1))
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (disabled) return
    // Firefox는 setData 호출이 없으면 드래그 자체가 시작되지 않는다.
    e.dataTransfer.setData('text/plain', String(index))
    e.dataTransfer.effectAllowed = 'move'
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    // dragIndex === null(리스트 밖 OS 파일 드래그 등)일 때는 preventDefault 하지 않는다 —
    // 부모 드롭존(파일 추가용)이 그대로 처리하도록 둔다.
    if (disabled || dragIndex === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDrop = (e: React.DragEvent, index: number) => {
    if (disabled || dragIndex === null) return
    e.preventDefault()
    if (dragIndex !== index) {
      const next = [...files]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(index, 0, moved)
      onReorder(next)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  return (
    <ul className="space-y-1.5">
      {files.map((file, index) => (
        <li
          key={`${file.name}-${index}`}
          draggable={!disabled}
          onDragStart={(e) => handleDragStart(e, index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={(e) => handleDrop(e, index)}
          onDragEnd={handleDragEnd}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 transition-colors ${
            dragOverIndex === index && dragIndex !== null && dragIndex !== index
              ? 'border-blue-500 bg-blue-50'
              : 'border-border'
          }`}
        >
          <svg
            className={`w-4 h-4 shrink-0 ${disabled ? 'text-muted-foreground/40' : 'text-muted-foreground cursor-grab'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
          </svg>

          <span className="flex items-center justify-center w-5 h-5 shrink-0 rounded-full bg-muted text-xs font-medium text-muted-foreground">
            {index + 1}
          </span>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              aria-label={`${file.name} 위로 이동`}
              disabled={disabled || index === 0}
              onClick={() => moveUp(index)}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={`${file.name} 아래로 이동`}
              disabled={disabled || index === files.length - 1}
              onClick={() => moveDown(index)}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={`${file.name} 삭제`}
              disabled={disabled}
              onClick={() => onRemove(index)}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

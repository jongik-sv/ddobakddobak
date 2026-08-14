import { useEffect, useRef, useState } from 'react'

interface MeetingFileDropOverlayProps {
  /** true면 이벤트 구독 자체를 하지 않는다 (오버레이도 표시되지 않고 onFilesDropped도 호출되지 않는다). */
  disabled?: boolean
  /** drop된 파일 원본 그대로 전달. 오디오/기타 분류(triage)는 호출측 책임. */
  onFilesDropped: (files: File[]) => void
}

/** dataTransfer에 파일 드래그가 실려 있는지 판정한다 (텍스트 드래그 등은 무시). */
function hasFilesType(e: DragEvent): boolean {
  const types = e.dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}

/**
 * 회의 페이지 전체를 드롭존으로 만드는 오버레이.
 *
 * document 레벨에서 dragenter/dragover/dragleave/drop을 구독한다 — 페이지 어디에 드롭해도
 * 반응해야 하고, 특정 컨테이너 ref에 의존하지 않기 위함이다.
 *
 * - dragenter/dragover: `dataTransfer.types`에 'Files'가 포함된 경우에만 오버레이를 표시한다.
 * - drop: `dataTransfer.files.length > 0`인 경우에만 onFilesDropped를 호출한다 — 이 가드가
 *   없으면 페이지 내부 컴포넌트(AudioFileOrderList 등)의 재정렬 드래그(dataTransfer.files가
 *   비어있는 HTML5 drag)를 파일 드롭으로 오인해 원치 않는 triage 플로우가 열린다.
 * - dragenter/dragleave는 카운터로 관리한다 — 자식 요소 경계를 넘나들 때마다 enter/leave가
 *   반복 발화하는데, 단순 boolean이면 그때마다 오버레이가 깜빡인다(플리커). 카운터가 0으로
 *   돌아올 때만 숨긴다.
 */
export function MeetingFileDropOverlay({ disabled = false, onFilesDropped }: MeetingFileDropOverlayProps) {
  const [visible, setVisible] = useState(false)
  const counterRef = useRef(0)

  useEffect(() => {
    if (disabled) return

    const onDragEnter = (e: DragEvent) => {
      if (!hasFilesType(e)) return
      e.preventDefault()
      counterRef.current += 1
      setVisible(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!hasFilesType(e)) return
      // 브라우저 기본 동작(파일을 새 탭으로 열기)을 막아야 drop 이벤트가 발생한다.
      e.preventDefault()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!hasFilesType(e)) return
      counterRef.current = Math.max(0, counterRef.current - 1)
      if (counterRef.current === 0) setVisible(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFilesType(e)) return
      e.preventDefault()
      counterRef.current = 0
      setVisible(false)
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : []
      if (files.length > 0) onFilesDropped(files)
    }

    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      // disabled로 전환되거나 언마운트될 때 구독이 끊기므로 남아있던 오버레이도 함께 지운다.
      counterRef.current = 0
      setVisible(false)
    }
  }, [disabled, onFilesDropped])

  if (!visible) return null

  return (
    <div
      data-testid="meeting-file-drop-overlay"
      aria-hidden="true"
      className="fixed inset-0 z-[70] flex items-center justify-center border-4 border-dashed border-blue-400 bg-blue-500/10 pointer-events-none"
    >
      <div className="rounded-xl border border-blue-300 bg-card/95 px-8 py-6 shadow-2xl">
        <p className="text-lg font-semibold text-foreground">파일을 놓아 추가</p>
      </div>
    </div>
  )
}

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MeetingFileDropOverlay } from './MeetingFileDropOverlay'

function makeFile(name: string): File {
  return new File([new Uint8Array(4)], name, { type: 'audio/mpeg' })
}

function dragEvent(type: string, target: EventTarget, dataTransfer: Record<string, unknown>) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer, configurable: true })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

describe('MeetingFileDropOverlay', () => {
  afterEach(() => {
    cleanup()
  })

  it('dataTransfer.types에 Files가 없으면 dragenter에도 오버레이를 띄우지 않는다', () => {
    const onFilesDropped = vi.fn()
    render(<MeetingFileDropOverlay onFilesDropped={onFilesDropped} />)

    dragEvent('dragenter', document, { types: ['text/plain'] })

    expect(screen.queryByTestId('meeting-file-drop-overlay')).not.toBeInTheDocument()
  })

  it('dataTransfer.types에 Files가 있으면 dragenter에서 오버레이를 띄운다', () => {
    const onFilesDropped = vi.fn()
    render(<MeetingFileDropOverlay onFilesDropped={onFilesDropped} />)

    dragEvent('dragenter', document, { types: ['Files'] })

    expect(screen.getByTestId('meeting-file-drop-overlay')).toBeInTheDocument()
  })

  it('dragenter/dragleave 카운터가 0으로 돌아와야 오버레이를 숨긴다 (자식 경계 플리커 방지)', () => {
    const onFilesDropped = vi.fn()
    render(<MeetingFileDropOverlay onFilesDropped={onFilesDropped} />)

    // 부모 → 자식으로 넘어갈 때 enter가 두 번, leave가 한 번 발생하는 상황을 흉내낸다.
    dragEvent('dragenter', document, { types: ['Files'] })
    dragEvent('dragenter', document, { types: ['Files'] })
    dragEvent('dragleave', document, { types: ['Files'] })
    expect(screen.getByTestId('meeting-file-drop-overlay')).toBeInTheDocument()

    dragEvent('dragleave', document, { types: ['Files'] })
    expect(screen.queryByTestId('meeting-file-drop-overlay')).not.toBeInTheDocument()
  })

  it('drop 시 dataTransfer.files.length > 0이면 onFilesDropped(files)를 호출한다', () => {
    const onFilesDropped = vi.fn()
    render(<MeetingFileDropOverlay onFilesDropped={onFilesDropped} />)
    const file = makeFile('a.mp3')

    dragEvent('dragenter', document, { types: ['Files'] })
    dragEvent('drop', document, { types: ['Files'], files: [file] })

    expect(onFilesDropped).toHaveBeenCalledTimes(1)
    expect(onFilesDropped.mock.calls[0][0]).toEqual([file])
    // drop 후 오버레이는 사라진다
    expect(screen.queryByTestId('meeting-file-drop-overlay')).not.toBeInTheDocument()
  })

  it('drop 시 dataTransfer.files가 비어있으면 onFilesDropped를 호출하지 않는다 (내부 재정렬 드래그 오인 방지)', () => {
    const onFilesDropped = vi.fn()
    render(<MeetingFileDropOverlay onFilesDropped={onFilesDropped} />)

    dragEvent('dragenter', document, { types: ['Files'] })
    dragEvent('drop', document, { types: ['Files'], files: [] })

    expect(onFilesDropped).not.toHaveBeenCalled()
  })

  it('disabled=true면 dragenter에도 오버레이를 띄우지 않는다', () => {
    const onFilesDropped = vi.fn()
    render(<MeetingFileDropOverlay disabled onFilesDropped={onFilesDropped} />)

    dragEvent('dragenter', document, { types: ['Files'] })
    expect(screen.queryByTestId('meeting-file-drop-overlay')).not.toBeInTheDocument()

    dragEvent('drop', document, { types: ['Files'], files: [makeFile('a.mp3')] })
    expect(onFilesDropped).not.toHaveBeenCalled()
  })
})

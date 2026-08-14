import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AudioFileOrderList } from './AudioFileOrderList'

function makeFile(name: string, size: number): File {
  const file = new File([new Uint8Array(size)], name, { type: 'audio/mpeg' })
  return file
}

describe('AudioFileOrderList', () => {
  let onReorder: Mock<(next: File[]) => void>
  let onRemove: Mock<(index: number) => void>
  let files: File[]

  beforeEach(() => {
    onReorder = vi.fn<(next: File[]) => void>()
    onRemove = vi.fn<(index: number) => void>()
    files = [makeFile('a.mp3', 1024), makeFile('b.mp3', 2048), makeFile('c.mp3', 3072)]
  })

  it('파일명과 순번을 렌더한다', () => {
    render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} />)
    expect(screen.getByText('a.mp3')).toBeInTheDocument()
    expect(screen.getByText('b.mp3')).toBeInTheDocument()
    expect(screen.getByText('c.mp3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('▼ 클릭 시 아래 항목과 순서를 바꾸고 onReorder를 호출한다 (원본 배열은 불변)', () => {
    const original = [...files]
    render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} />)
    const downButtons = screen.getAllByLabelText(/아래로 이동$/)
    fireEvent.click(downButtons[0])
    expect(onReorder).toHaveBeenCalledTimes(1)
    const next = onReorder.mock.calls[0][0] as File[]
    expect(next.map((f) => f.name)).toEqual(['b.mp3', 'a.mp3', 'c.mp3'])
    // 원본 배열은 변형되지 않아야 한다
    expect(files.map((f) => f.name)).toEqual(original.map((f) => f.name))
  })

  it('▲ 클릭 시 위 항목과 순서를 바꾸고 onReorder를 호출한다', () => {
    render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} />)
    const upButtons = screen.getAllByLabelText(/위로 이동$/)
    fireEvent.click(upButtons[1])
    expect(onReorder).toHaveBeenCalledTimes(1)
    const next = onReorder.mock.calls[0][0] as File[]
    expect(next.map((f) => f.name)).toEqual(['b.mp3', 'a.mp3', 'c.mp3'])
  })

  it('첫 항목의 ▲ 버튼은 disabled다', () => {
    render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} />)
    const upButtons = screen.getAllByLabelText(/위로 이동$/)
    expect(upButtons[0]).toBeDisabled()
  })

  it('마지막 항목의 ▼ 버튼은 disabled다', () => {
    render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} />)
    const downButtons = screen.getAllByLabelText(/아래로 이동$/)
    expect(downButtons[downButtons.length - 1]).toBeDisabled()
  })

  it('X 클릭 시 onRemove(index)를 호출한다', () => {
    render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} />)
    const removeButtons = screen.getAllByLabelText(/삭제$/)
    fireEvent.click(removeButtons[1])
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('아이콘 버튼 aria-label에 파일명이 포함되어 스크린리더가 행을 구분할 수 있다', () => {
    render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} />)
    expect(screen.getByLabelText('b.mp3 위로 이동')).toBeInTheDocument()
    expect(screen.getByLabelText('b.mp3 아래로 이동')).toBeInTheDocument()
    expect(screen.getByLabelText('b.mp3 삭제')).toBeInTheDocument()
  })

  it('drag & drop으로 순서를 변경한다 (0번을 2번 위치로 이동)', () => {
    const { container } = render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} />)
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(3)

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(),
    }

    fireEvent.dragStart(items[0], { dataTransfer })
    // Firefox 대응: dragstart 시 setData 호출 + effectAllowed 지정 필요
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '0')
    expect(dataTransfer.effectAllowed).toBe('move')

    fireEvent.dragOver(items[2], { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('move')

    fireEvent.drop(items[2], { dataTransfer })

    expect(onReorder).toHaveBeenCalledTimes(1)
    const next = onReorder.mock.calls[0][0] as File[]
    expect(next.map((f) => f.name)).toEqual(['b.mp3', 'c.mp3', 'a.mp3'])
  })

  it('disabled=true면 이동·삭제 버튼이 모두 비활성화된다', () => {
    render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} disabled />)
    for (const btn of screen.getAllByLabelText(/위로 이동$/)) expect(btn).toBeDisabled()
    for (const btn of screen.getAllByLabelText(/아래로 이동$/)) expect(btn).toBeDisabled()
    for (const btn of screen.getAllByLabelText(/삭제$/)) expect(btn).toBeDisabled()
  })

  it('disabled=true면 드래그로도 순서가 바뀌지 않는다', () => {
    const { container } = render(<AudioFileOrderList files={files} onReorder={onReorder} onRemove={onRemove} disabled />)
    const items = container.querySelectorAll('li')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() }

    fireEvent.dragStart(items[0], { dataTransfer })
    fireEvent.dragOver(items[2], { dataTransfer })
    fireEvent.drop(items[2], { dataTransfer })

    expect(onReorder).not.toHaveBeenCalled()
  })
})

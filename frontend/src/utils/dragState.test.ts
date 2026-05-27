import { describe, it, expect, afterEach } from 'vitest'
import { initDrag, dragState, clearDrag } from './dragState'

/** initDrag이 기대하는 최소한의 React.PointerEvent 형태 */
function fakePointerDown() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  return { clientX: 0, clientY: 0, target } as unknown as React.PointerEvent
}

function dispatchPointer(type: string, x: number, y: number) {
  document.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }))
}

describe('dragState 드래그 고스트/취소 처리', () => {
  afterEach(() => {
    clearDrag()
    document.body.removeAttribute('data-dragging')
  })

  it('드래그를 시작해도 화면에 고스트(흰 이름 박스)를 만들지 않는다', () => {
    initDrag('folder', 1, fakePointerDown())

    // 임계값을 넘겨 드래그 시작
    dispatchPointer('pointermove', 20, 20)
    expect(dragState.active).toBe(true)
    expect(document.querySelectorAll('.drag-ghost').length).toBe(0)
    expect(document.body.getAttribute('data-dragging')).toBe('true')
  })

  it('pointercancel 시 드래그 상태와 dragging 표시를 정리한다', () => {
    initDrag('folder', 1, fakePointerDown())
    dispatchPointer('pointermove', 20, 20)
    expect(dragState.active).toBe(true)

    // 터치 스크롤 전환 등으로 브라우저가 포인터를 취소
    dispatchPointer('pointercancel', 20, 20)
    expect(dragState.active).toBe(false)
    expect(document.body.hasAttribute('data-dragging')).toBe(false)
  })

  it('여러 번 취소된 드래그가 잔여물을 누적하지 않는다', () => {
    for (let i = 0; i < 3; i++) {
      initDrag('folder', i, fakePointerDown())
      dispatchPointer('pointermove', 20, 20)
      dispatchPointer('pointercancel', 20, 20)
    }
    expect(document.querySelectorAll('.drag-ghost').length).toBe(0)
    expect(dragState.active).toBe(false)
    expect(document.body.hasAttribute('data-dragging')).toBe(false)
  })
})

import { useEffect } from 'react'
import { usePanelRef } from 'react-resizable-panels'

/**
 * 우측(메모·AI챗 등) 패널은 항상 마운트해두고 collapse/expand로만 크기를 바꾼다.
 * 패널을 통째로 언마운트하면 react-resizable-panels가 남은 패널들의 flex 비율을
 * 재정규화(renormalize)해 옆 패널들의 경계가 같이 움직인다 — 그래서
 * 이 방식 대신 패널 개수를 고정하고 우측 패널만 0으로 접어 가운데 패널이 그 폭을 흡수하게 한다.
 * (MeetingPage.tsx ↔ MeetingLivePage.tsx 동일 버그의 공용 해법)
 */
export function useRightPanelCollapse(visible: boolean) {
  const panelRef = usePanelRef()
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (visible) panel.expand()
    else panel.collapse()
  }, [visible, panelRef])
  return panelRef
}

import { useEffect } from 'react'
import { openHelp } from './openHelp'

/** F1 → 매뉴얼 열기. App 루트에서 1회만 호출한다. 입력창 포커스 중에도 동작. */
export function useHelpShortcut(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'F1') return
      e.preventDefault()
      void openHelp()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

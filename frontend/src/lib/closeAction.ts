export type CloseAction = 'hide' | 'quit'
const KEY = 'closeAction'

export function getCloseAction(): CloseAction | null {
  const v = localStorage.getItem(KEY)
  return v === 'hide' || v === 'quit' ? v : null
}

export function setCloseAction(a: CloseAction): void {
  localStorage.setItem(KEY, a)
}

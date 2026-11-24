import { slugForPath } from './helpRoutes'

function lastAttr(root: ParentNode | Element, attr: string): string | null {
  const found: string[] = []
  const self = (root as Element).getAttribute?.(attr)
  if (self) found.push(self)
  root.querySelectorAll(`[${attr}]`).forEach((el) => {
    const v = el.getAttribute(attr)
    if (v) found.push(v)
  })
  return found.length ? found[found.length - 1] : null
}

/**
 * 현재 화면에 맞는 매뉴얼 slug. 빈 문자열 = 매뉴얼 첫 화면.
 * 우선순위: ① 열린 dialog 의 data-help(마지막) ② [data-help-page](마지막) ③ 라우트 표 ④ 첫 화면.
 */
export function resolveHelpSlug(pathname: string, doc: Document): string {
  const dialogs = Array.from(doc.querySelectorAll('[role="dialog"]'))
  for (let i = dialogs.length - 1; i >= 0; i--) {
    const v = lastAttr(dialogs[i], 'data-help')
    if (v) return v
  }
  const page = lastAttr(doc, 'data-help-page')
  if (page) return page
  return slugForPath(pathname) ?? ''
}

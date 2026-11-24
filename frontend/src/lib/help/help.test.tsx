import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveHelpSlug } from './resolveHelpSlug'
import { buildHelpUrl, openHelp } from './openHelp'
import { useHelpShortcut } from './useHelpShortcut'
import { HELP_ROUTES, HELP_ATTR_SLUGS, MANUAL_BASE_URL } from './helpRoutes'

// 명세 §2 slug 목록 (정본: tasks/manual-site/spec.md)
const SPEC_SLUGS = [
  'start/overview', 'start/install', 'start/first-run', 'start/login', 'start/project-select',
  'projects/projects', 'projects/sidebar-folders',
  'meetings/dashboard', 'meetings/list', 'meetings/new-meeting',
  'recording/live', 'recording/system-audio', 'recording/upload', 'recording/offline',
  'minutes/meeting-detail', 'minutes/ai-summary', 'minutes/transcript', 'minutes/speakers', 'minutes/linked-meetings',
  'ai/search', 'ai/chat', 'ai/folder-chat',
  'share/live-share', 'share/collaborators', 'share/export', 'share/archive', 'share/dflow',
  'schedule/schedule', 'schedule/background',
  'settings/personal', 'settings/llm', 'settings/voice', 'settings/meeting', 'settings/integrations',
  'settings/stt-learning', 'settings/users', 'settings/meeting-api',
  'trash/trash', 'help/shortcuts', 'help/troubleshooting', 'help/faq',
]

function mkDoc(html: string): Document {
  document.body.innerHTML = html
  return document
}

describe('resolveHelpSlug 라우트', () => {
  const cases: Array<[string, string]> = [
    ['/', 'start/project-select'],
    ['/dashboard', 'meetings/dashboard'],
    ['/search', 'ai/search'],
    ['/projects', 'projects/projects'],
    ['/meetings', 'meetings/list'],
    ['/meetings/12/live', 'recording/live'],
    ['/meetings/12/viewer', 'share/live-share'],
    ['/meetings/12', 'minutes/meeting-detail'],
    ['/trash', 'trash/trash'],
    ['/local-meetings', 'recording/offline'],
    ['/local-meetings/abc', 'recording/offline'],
    ['/local-meetings/abc/live', 'recording/offline'],
    ['/invite/XYZ', 'projects/projects'],
    ['/unknown/page', ''],
  ]
  it.each(cases)('%s -> %s', (path, slug) => {
    expect(resolveHelpSlug(path, mkDoc(''))).toBe(slug)
  })
})

describe('resolveHelpSlug 우선순위', () => {
  it('열린 dialog 의 data-help 가 라우트보다 우선', () => {
    const d = mkDoc('<div role="dialog"><div data-help="settings/llm"></div></div>')
    expect(resolveHelpSlug('/meetings', d)).toBe('settings/llm')
  })
  it('dialog 자신의 data-help', () => {
    const d = mkDoc('<div role="dialog" data-help="settings/users"></div>')
    expect(resolveHelpSlug('/meetings', d)).toBe('settings/users')
  })
  it('dialog 안 여러 개면 마지막', () => {
    const d = mkDoc('<div role="dialog"><i data-help="a/x"></i><i data-help="settings/voice"></i></div>')
    expect(resolveHelpSlug('/', d)).toBe('settings/voice')
  })
  it('dialog 밖의 data-help 는 무시', () => {
    const d = mkDoc('<div data-help="settings/llm"></div>')
    expect(resolveHelpSlug('/trash', d)).toBe('trash/trash')
  })
  it('data-help 없는 dialog 는 data-help-page / 라우트로 폴백', () => {
    const d = mkDoc('<div role="dialog"></div>')
    expect(resolveHelpSlug('/trash', d)).toBe('trash/trash')
  })
  it('data-help-page 가 라우트보다 우선', () => {
    const d = mkDoc('<div data-help-page="start/login"></div>')
    expect(resolveHelpSlug('/', d)).toBe('start/login')
  })
  it('dialog data-help 가 data-help-page 보다 우선', () => {
    const d = mkDoc('<div data-help-page="start/login"></div><div role="dialog" data-help="settings/users"></div>')
    expect(resolveHelpSlug('/', d)).toBe('settings/users')
  })
})

describe('buildHelpUrl', () => {
  it('slug 조립', () => {
    expect(buildHelpUrl('settings/llm')).toBe('https://jongik-sv.github.io/ddobakddobak/manual/settings/llm/')
  })
  it('빈 slug = 첫 화면', () => {
    expect(buildHelpUrl('')).toBe(MANUAL_BASE_URL)
  })
  it('앞뒤 슬래시 정리', () => {
    expect(buildHelpUrl('/a/b/')).toBe(`${MANUAL_BASE_URL}a/b/`)
  })
})

describe('openHelp (웹)', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('window.open(url,_blank,noopener)', async () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null)
    mkDoc('<div data-help-page="start/login"></div>')
    await openHelp()
    expect(spy).toHaveBeenCalledWith(`${MANUAL_BASE_URL}start/login/`, '_blank', 'noopener')
  })
})

describe('useHelpShortcut', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { vi.restoreAllMocks() })
  it('F1 은 preventDefault 하고 매뉴얼을 연다(입력창 포커스 중에도)', () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null)
    renderHook(() => useHelpShortcut())
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const ev = new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('다른 키는 무시', () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null)
    renderHook(() => useHelpShortcut())
    const ev = new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
  it('언마운트 시 해제', () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null)
    const { unmount } = renderHook(() => useHelpShortcut())
    unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', cancelable: true }))
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('slug 일관성 (명세 §2)', () => {
  const used = [...new Set([...HELP_ROUTES.map(([, s]) => s), ...HELP_ATTR_SLUGS])]
  it('모든 사용 slug 는 명세 목록에 있다', () => {
    for (const s of used) expect(SPEC_SLUGS, s).toContain(s)
  })
  it('data-help 로 소스에 쓰인 slug 가 HELP_ATTR_SLUGS 와 일치한다', async () => {
    const { readFileSync } = await import('node:fs')
    const files = [
      '../../components/settings/SettingsContent.tsx',
      '../../components/settings/UserManagementModal.tsx',
      '../../pages/SetupPage.tsx',
      '../../components/auth/ServerSetup.tsx',
      '../../components/auth/LoginPage.tsx',
    ]
    const src = files.map((f) => readFileSync(resolve(__dirname, f), 'utf8')).join('\n')
    const found = new Set<string>()
    for (const m of src.matchAll(/data-help(?:-page)?=["'{`]+\s*["'`]?([a-z-]+\/[a-z-]+)/g)) found.add(m[1])
    for (const m of src.matchAll(/id: '(personal|llm|voice|meeting)'/g)) found.add(`settings/${m[1]}`)
    for (const s of found) expect(HELP_ATTR_SLUGS, s).toContain(s)
    for (const s of ['settings/users', 'start/first-run', 'start/login']) expect(found.has(s), s).toBe(true)
  })
  it('사이트에 <slug>.md(x) 가 존재한다', () => {
    const root = resolve(__dirname, '../../../../site/src/content/docs')
    const missing = used.filter((s) => !existsSync(`${root}/${s}.md`) && !existsSync(`${root}/${s}.mdx`))
    expect(missing).toEqual([])
  })
})

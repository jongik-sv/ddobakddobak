import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UserSttSettings from './UserSttSettings'

// 온디바이스 패널은 IS_TAURI && IS_MOBILE 게이트가 통과해야만 렌더된다.
vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config')>()
  return {
    ...actual,
    IS_TAURI: true,
    IS_MOBILE: true,
  }
})

// ModelManager는 jsdom에서 Tauri invoke(cohereModelStatus)를 호출하므로 스텁으로 대체.
vi.mock('../stt/ModelManager', () => ({
  default: () => <div data-testid="model-manager">ModelManager</div>,
}))

// ── appSettingsStore mock ──
const setSttMode = vi.fn()
const setLocalUploadEnabled = vi.fn()
let storeState: Record<string, unknown> = {
  sttMode: 'auto',
  setSttMode,
  localUploadEnabled: false,
  setLocalUploadEnabled,
}

vi.mock('../../stores/appSettingsStore', () => ({
  useAppSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(storeState),
}))

describe('UserSttSettings', () => {
  beforeEach(() => {
    setSttMode.mockClear()
    setLocalUploadEnabled.mockClear()
    storeState = {
      sttMode: 'auto',
      setSttMode,
      localUploadEnabled: false,
      setLocalUploadEnabled,
    }
  })

  it('3-way 라디오(auto/server/local) 3개를 렌더한다', () => {
    render(<UserSttSettings />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    const values = radios.map((r) => (r as HTMLInputElement).value).sort()
    expect(values).toEqual(['auto', 'local', 'server'])
  })

  // 라디오의 접근가능 이름(label+desc)에 "서버/온디바이스" 문구가 여러 옵션에 겹쳐
  // 나타나므로, 고유한 value 속성으로 식별한다.
  const radioByValue = (value: string) =>
    screen.getAllByRole('radio').find((r) => (r as HTMLInputElement).value === value) as HTMLInputElement

  it('현재 sttMode 라디오가 선택되어 있다', () => {
    storeState = { ...storeState, sttMode: 'local' }
    render(<UserSttSettings />)
    expect(radioByValue('local').checked).toBe(true)
    expect(radioByValue('auto').checked).toBe(false)
  })

  it('다른 모드 선택 시 setSttMode를 해당 값으로 호출한다', () => {
    render(<UserSttSettings />)
    fireEvent.click(radioByValue('server'))
    expect(setSttMode).toHaveBeenCalledWith('server')

    fireEvent.click(radioByValue('local'))
    expect(setSttMode).toHaveBeenCalledWith('local')
  })

  it('ModelManager를 포함한다', () => {
    render(<UserSttSettings />)
    expect(screen.getByTestId('model-manager')).toBeInTheDocument()
  })

  it('로컬 업로드 체크박스 토글 시 setLocalUploadEnabled를 호출한다', () => {
    render(<UserSttSettings />)
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(setLocalUploadEnabled).toHaveBeenCalledWith(true)
  })
})

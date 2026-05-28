import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UserLanguageSettings from './UserLanguageSettings'
import type { UserLanguageSettingsResponse } from '../../api/userLanguageSettings'

vi.mock('../../api/userLanguageSettings', () => ({
  getUserLanguageSettings: vi.fn(),
  updateUserLanguageSettings: vi.fn(),
}))

import { getUserLanguageSettings, updateUserLanguageSettings } from '../../api/userLanguageSettings'

const mockGet = vi.mocked(getUserLanguageSettings)
const mockUpdate = vi.mocked(updateUserLanguageSettings)

const singleResponse: UserLanguageSettingsResponse = {
  language_settings: { mode: 'single', languages: ['ko'], configured: true },
  server_default: { mode: 'single', languages: ['ko'] },
}

const multiResponse: UserLanguageSettingsResponse = {
  language_settings: { mode: 'multi', languages: ['ko', 'en'], configured: true },
  server_default: { mode: 'single', languages: ['ko'] },
}

describe('UserLanguageSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockResolvedValue(singleResponse)
  })

  it('로딩 중일 때 로딩 텍스트를 표시한다', () => {
    mockGet.mockReturnValue(new Promise(() => {}))
    render(<UserLanguageSettings />)
    expect(screen.getByText('불러오는 중...')).toBeInTheDocument()
  })

  it('저장된 설정을 불러와 모드를 반영한다 (multi)', async () => {
    mockGet.mockResolvedValue(multiResponse)
    render(<UserLanguageSettings />)
    await waitFor(() => {
      expect((screen.getByRole('radio', { name: /다국어/ }) as HTMLInputElement).checked).toBe(true)
    })
  })

  it('single 모드 저장 시 선택한 언어로 updateUserLanguageSettings를 호출한다', async () => {
    mockGet.mockResolvedValue(singleResponse)
    render(<UserLanguageSettings />)

    await waitFor(() => screen.getByRole('radio', { name: /단일 언어/ }))

    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        language_settings: { mode: 'single', languages: ['ko'] },
      })
    })
  })

  it('multi 모드로 전환 후 저장하면 mode=multi로 호출한다', async () => {
    mockGet.mockResolvedValue(singleResponse)
    mockUpdate.mockResolvedValue(multiResponse)
    render(<UserLanguageSettings />)

    await waitFor(() => screen.getByRole('radio', { name: /다국어/ }))
    fireEvent.click(screen.getByRole('radio', { name: /다국어/ }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          language_settings: expect.objectContaining({ mode: 'multi' }),
        })
      )
    })
  })
})

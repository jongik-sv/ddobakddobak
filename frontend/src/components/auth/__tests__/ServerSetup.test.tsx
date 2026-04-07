import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ServerSetup } from '../ServerSetup'

describe('ServerSetup', () => {
  const onComplete = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    onComplete.mockClear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // a. 초기 렌더링: 모드 선택 UI 표시
  describe('초기 렌더링', () => {
    it('로컬 실행 / 서버 연결 모드 선택 카드가 표시된다', () => {
      render(<ServerSetup onComplete={onComplete} />)

      expect(screen.getByText('로컬 실행')).toBeInTheDocument()
      expect(screen.getByText('서버 연결')).toBeInTheDocument()
    })

    it('시작하기 버튼이 표시된다', () => {
      render(<ServerSetup onComplete={onComplete} />)

      expect(screen.getByRole('button', { name: /시작하기/ })).toBeInTheDocument()
    })

    it('모드 미선택 시 시작하기 버튼이 비활성화된다', () => {
      render(<ServerSetup onComplete={onComplete} />)

      const startButton = screen.getByRole('button', { name: /시작하기/ })
      expect(startButton).toBeDisabled()
    })
  })

  // b. 서버 연결 선택 시 URL 입력 필드 표시
  describe('서버 연결 모드 선택', () => {
    it('서버 연결 선택 시 URL 입력 필드가 표시된다', async () => {
      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      expect(screen.getByPlaceholderText('https://api.example.com')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /연결 확인/ })).toBeInTheDocument()
    })

    it('서버 모드에서 헬스체크 미완료 시 시작하기 버튼이 비활성화된다', async () => {
      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const startButton = screen.getByRole('button', { name: /시작하기/ })
      expect(startButton).toBeDisabled()
    })
  })

  // c. 로컬 실행 선택 시 URL 입력 필드 미표시
  describe('로컬 실행 모드 선택', () => {
    it('로컬 실행 선택 시 URL 입력 필드가 표시되지 않는다', async () => {
      render(<ServerSetup onComplete={onComplete} />)

      const localCard = screen.getByText('로컬 실행').closest('button')!
      await act(async () => {
        fireEvent.click(localCard)
      })

      expect(screen.queryByPlaceholderText('https://api.example.com')).not.toBeInTheDocument()
    })

    it('로컬 모드 선택 시 시작하기 버튼이 활성화된다', async () => {
      render(<ServerSetup onComplete={onComplete} />)

      const localCard = screen.getByText('로컬 실행').closest('button')!
      await act(async () => {
        fireEvent.click(localCard)
      })

      const startButton = screen.getByRole('button', { name: /시작하기/ })
      expect(startButton).not.toBeDisabled()
    })
  })

  // d. 헬스체크 성공 시 연결 확인 표시
  describe('헬스체크 성공', () => {
    it('서버 URL 입력 후 헬스체크 성공 시 연결 성공 메시지가 표시된다', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', fetchMock)

      render(<ServerSetup onComplete={onComplete} />)

      // 서버 모드 선택
      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      // URL 입력
      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com' } })
      })

      // 연결 확인 클릭
      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(screen.getByText('서버 연결 성공')).toBeInTheDocument()
      })

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/health',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('헬스체크 성공 후 시작하기 버튼이 활성화된다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        const startButton = screen.getByRole('button', { name: /시작하기/ })
        expect(startButton).not.toBeDisabled()
      })
    })
  })

  // e. 헬스체크 실패 시 에러 메시지 표시
  describe('헬스체크 실패', () => {
    it('서버 응답 오류 시 에러 메시지가 표시된다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(screen.getByText(/서버 응답 오류/)).toBeInTheDocument()
      })
    })

    it('네트워크 에러 시 연결 불가 메시지가 표시된다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(screen.getByText(/서버에 연결할 수 없습니다/)).toBeInTheDocument()
      })
    })

    it('타임아웃 에러 시 시간 초과 메시지가 표시된다', async () => {
      const timeoutError = new DOMException('The operation was aborted', 'TimeoutError')
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError))

      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(screen.getByText(/시간이 초과되었습니다/)).toBeInTheDocument()
      })
    })
  })

  // f. 설정 저장 시 localStorage에 mode, server_url 저장
  describe('설정 저장', () => {
    it('로컬 모드 선택 후 시작하기 시 localStorage에 mode=local 저장', async () => {
      render(<ServerSetup onComplete={onComplete} />)

      const localCard = screen.getByText('로컬 실행').closest('button')!
      await act(async () => {
        fireEvent.click(localCard)
      })

      const startButton = screen.getByRole('button', { name: /시작하기/ })
      await act(async () => {
        fireEvent.click(startButton)
      })

      expect(localStorage.getItem('mode')).toBe('local')
      expect(localStorage.getItem('server_url')).toBeNull()
    })

    it('서버 모드에서 헬스체크 성공 후 시작하기 시 localStorage에 mode=server, server_url 저장', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(screen.getByText('서버 연결 성공')).toBeInTheDocument()
      })

      const startButton = screen.getByRole('button', { name: /시작하기/ })
      await act(async () => {
        fireEvent.click(startButton)
      })

      expect(localStorage.getItem('mode')).toBe('server')
      expect(localStorage.getItem('server_url')).toBe('https://api.example.com')
    })
  })

  // g. localStorage에 기존 설정이 있으면 초기값으로 로드
  describe('기존 설정 복원', () => {
    it('localStorage에 mode=local이 있으면 로컬 모드가 선택된 상태로 렌더링', () => {
      localStorage.setItem('mode', 'local')

      render(<ServerSetup onComplete={onComplete} />)

      // 로컬 모드가 선택되었으므로 시작하기 버튼이 활성화되어야 함
      const startButton = screen.getByRole('button', { name: /시작하기/ })
      expect(startButton).not.toBeDisabled()
    })

    it('localStorage에 mode=server, server_url이 있으면 서버 모드와 URL이 복원된다', () => {
      localStorage.setItem('mode', 'server')
      localStorage.setItem('server_url', 'https://saved.example.com')

      render(<ServerSetup onComplete={onComplete} />)

      const urlInput = screen.getByPlaceholderText('https://api.example.com') as HTMLInputElement
      expect(urlInput.value).toBe('https://saved.example.com')
    })
  })

  // h. URL 후행 슬래시 자동 제거
  describe('URL 정규화', () => {
    it('후행 슬래시가 있는 URL로 헬스체크 시 슬래시 제거 후 요청', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', fetchMock)

      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com///' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.example.com/api/v1/health',
          expect.any(Object)
        )
      })
    })

    it('후행 슬래시가 있는 URL 저장 시 슬래시가 제거된다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com/' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(screen.getByText('서버 연결 성공')).toBeInTheDocument()
      })

      const startButton = screen.getByRole('button', { name: /시작하기/ })
      await act(async () => {
        fireEvent.click(startButton)
      })

      expect(localStorage.getItem('server_url')).toBe('https://api.example.com')
    })
  })

  // i. onComplete 콜백 호출
  describe('onComplete 콜백', () => {
    it('로컬 모드에서 시작하기 클릭 시 onComplete가 호출된다', async () => {
      render(<ServerSetup onComplete={onComplete} />)

      const localCard = screen.getByText('로컬 실행').closest('button')!
      await act(async () => {
        fireEvent.click(localCard)
      })

      const startButton = screen.getByRole('button', { name: /시작하기/ })
      await act(async () => {
        fireEvent.click(startButton)
      })

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('서버 모드에서 헬스체크 성공 후 시작하기 클릭 시 onComplete가 호출된다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(screen.getByText('서버 연결 성공')).toBeInTheDocument()
      })

      const startButton = screen.getByRole('button', { name: /시작하기/ })
      await act(async () => {
        fireEvent.click(startButton)
      })

      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })

  // 추가: URL 미입력 시 연결 확인 버튼 비활성화
  describe('URL 미입력', () => {
    it('URL 미입력 시 연결 확인 버튼이 비활성화된다', async () => {
      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      // config.yaml의 default_server_url로 입력창이 pre-fill 될 수 있으므로 명시적으로 비운다.
      const urlInput = screen.getByLabelText('서버 URL')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: '' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      expect(checkButton).toBeDisabled()
    })
  })

  // 추가: 헬스체크 중 URL 변경 시 상태 리셋
  describe('URL 변경 시 상태 리셋', () => {
    it('헬스체크 성공 후 URL을 변경하면 상태가 리셋된다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      render(<ServerSetup onComplete={onComplete} />)

      const serverCard = screen.getByText('서버 연결').closest('button')!
      await act(async () => {
        fireEvent.click(serverCard)
      })

      const urlInput = screen.getByPlaceholderText('https://api.example.com')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(screen.getByText('서버 연결 성공')).toBeInTheDocument()
      })

      // URL 변경
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://other.example.com' } })
      })

      // 성공 메시지가 사라져야 함
      expect(screen.queryByText('서버 연결 성공')).not.toBeInTheDocument()

      // 시작하기 버튼이 다시 비활성화
      const startButton = screen.getByRole('button', { name: /시작하기/ })
      expect(startButton).toBeDisabled()
    })
  })
})

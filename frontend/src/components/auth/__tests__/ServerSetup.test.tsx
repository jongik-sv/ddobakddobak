import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { ServerSetup } from '../ServerSetup'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../../config', async (orig) => {
  const actual = await orig<typeof import('../../../config')>()
  return { ...actual, IS_TAURI: true }
})

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

      expect(screen.getByLabelText('서버 URL')).toBeInTheDocument()
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

      expect(screen.queryByLabelText('서버 URL')).not.toBeInTheDocument()
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
      const urlInput = screen.getByLabelText('서버 URL')
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
        'https://api.example.com:13323/api/v1/health',
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

      const urlInput = screen.getByLabelText('서버 URL')
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

      const urlInput = screen.getByLabelText('서버 URL')
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

      const urlInput = screen.getByLabelText('서버 URL')
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

      const urlInput = screen.getByLabelText('서버 URL')
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

      const urlInput = screen.getByLabelText('서버 URL')
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
      expect(localStorage.getItem('server_url')).toBe('https://api.example.com:13323')
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

      const urlInput = screen.getByLabelText('서버 URL') as HTMLInputElement
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

      const urlInput = screen.getByLabelText('서버 URL')
      await act(async () => {
        fireEvent.change(urlInput, { target: { value: 'https://api.example.com///' } })
      })

      const checkButton = screen.getByRole('button', { name: /연결 확인/ })
      await act(async () => {
        fireEvent.click(checkButton)
      })

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.example.com:13323/api/v1/health',
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

      const urlInput = screen.getByLabelText('서버 URL')
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

      expect(localStorage.getItem('server_url')).toBe('https://api.example.com:13323')
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

      const urlInput = screen.getByLabelText('서버 URL')
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

      const urlInput = screen.getByLabelText('서버 URL')
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

  // 저장된 서버 목록: 렌더 규칙 / 편집 / 삭제
  describe('저장된 서버', () => {
    function enterServerMode() {
      const serverCard = screen.getByText('서버 연결').closest('button')!
      fireEvent.click(serverCard)
    }

    it('저장된 서버가 이름/호스트/포트 규칙대로 렌더된다', async () => {
      localStorage.setItem('recent_servers', JSON.stringify([
        { url: 'http://192.168.0.10:13323', name: '사무실', lastConnectedAt: 200 },
        { url: 'http://10.0.0.5:8080', location: '집', lastConnectedAt: 100 },
      ]))
      render(<ServerSetup onComplete={onComplete} />)
      await act(async () => { enterServerMode() })

      expect(screen.getByText('저장된 서버')).toBeInTheDocument()
      // name 우선 표시, 기본포트(13323)는 숨김
      expect(screen.getByText('사무실')).toBeInTheDocument()
      expect(screen.queryByText(/포트 13323/)).not.toBeInTheDocument()
      // 비기본포트는 표시, 위치도 표시
      expect(screen.getByText(/포트 8080/)).toBeInTheDocument()
      expect(screen.getByText(/집/)).toBeInTheDocument()
    })

    it('마운트 시 저장된 서버 연결 가능 여부를 자동 확인해 성공 아이콘을 표시한다', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', fetchMock)
      localStorage.setItem('recent_servers', JSON.stringify([
        { url: 'http://192.168.0.10:13323', name: '사무실', lastConnectedAt: 200 },
      ]))
      render(<ServerSetup onComplete={onComplete} />)
      await act(async () => { enterServerMode() })

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          'http://192.168.0.10:13323/api/v1/health',
          expect.objectContaining({ method: 'GET' }),
        ),
      )
      await waitFor(() => expect(screen.getByLabelText('연결 가능')).toBeInTheDocument())
    })

    it('연결 불가 서버는 실패 아이콘을 표시한다', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
      localStorage.setItem('recent_servers', JSON.stringify([
        { url: 'http://10.0.0.9:8080', name: '오프라인', lastConnectedAt: 100 },
      ]))
      render(<ServerSetup onComplete={onComplete} />)
      await act(async () => { enterServerMode() })

      await waitFor(() => expect(screen.getByLabelText('연결 불가')).toBeInTheDocument())
    })

    it('편집 → 이름 저장 시 표시가 갱신되고 localStorage 에 반영된다', async () => {
      localStorage.setItem('recent_servers', JSON.stringify([
        { url: 'http://192.168.0.10:13323', lastConnectedAt: 200 },
      ]))
      render(<ServerSetup onComplete={onComplete} />)
      await act(async () => { enterServerMode() })

      await act(async () => { fireEvent.click(screen.getByLabelText('편집')) })
      const nameInput = screen.getByLabelText('서버 이름')
      await act(async () => { fireEvent.change(nameInput, { target: { value: '사무실 서버' } }) })
      await act(async () => { fireEvent.click(screen.getByText('저장')) })

      expect(screen.getByText('사무실 서버')).toBeInTheDocument()
      const stored = JSON.parse(localStorage.getItem('recent_servers')!)
      expect(stored[0].name).toBe('사무실 서버')
    })

    it('삭제 시 행이 제거된다', async () => {
      localStorage.setItem('recent_servers', JSON.stringify([
        { url: 'http://192.168.0.10:13323', name: '삭제대상', lastConnectedAt: 200 },
      ]))
      render(<ServerSetup onComplete={onComplete} />)
      await act(async () => { enterServerMode() })

      expect(screen.getByText('삭제대상')).toBeInTheDocument()
      await act(async () => { fireEvent.click(screen.getByLabelText('삭제')) })
      expect(screen.queryByText('삭제대상')).not.toBeInTheDocument()
    })
  })

  // 스캔으로 찾은 서버: 연결 전에도 이름/위치 편집 가능
  describe('스캔 서버 편집', () => {
    function enterServerMode() {
      const serverCard = screen.getByText('서버 연결').closest('button')!
      fireEvent.click(serverCard)
    }

    async function scan() {
      ;(invoke as Mock).mockResolvedValue(['http://192.168.0.50:13323'])
      render(<ServerSetup onComplete={onComplete} />)
      await act(async () => { enterServerMode() })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /서버 찾기/ })) })
      await waitFor(() => expect(screen.getByText('http://192.168.0.50:13323')).toBeInTheDocument())
    }

    it('찾은 서버 줄에 편집 버튼이 있다', async () => {
      await scan()
      expect(screen.getByLabelText('편집')).toBeInTheDocument()
    })

    it('연결 전 편집·저장 시 이름이 localStorage 에 미접속 항목으로 저장된다', async () => {
      await scan()

      await act(async () => { fireEvent.click(screen.getByLabelText('편집')) })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('서버 이름'), { target: { value: '회의실 서버' } })
      })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('서버 위치'), { target: { value: '3층' } })
      })
      await act(async () => { fireEvent.click(screen.getByText('저장')) })

      const stored = JSON.parse(localStorage.getItem('recent_servers')!)
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({
        url: 'http://192.168.0.50:13323',
        name: '회의실 서버',
        location: '3층',
        lastConnectedAt: 0,
      })
    })

    it('편집 후 찾은 서버 줄에 저장한 이름이 표시된다', async () => {
      await scan()

      await act(async () => { fireEvent.click(screen.getByLabelText('편집')) })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('서버 이름'), { target: { value: '회의실 서버' } })
      })
      await act(async () => { fireEvent.click(screen.getByText('저장')) })

      expect(screen.getByText('회의실 서버')).toBeInTheDocument()
    })

    it('스캔에 뜬 서버는 "저장된 서버" 목록에 중복 표시되지 않는다', async () => {
      localStorage.setItem('recent_servers', JSON.stringify([
        { url: 'http://192.168.0.50:13323', name: '중복서버', lastConnectedAt: 100 },
      ]))
      await scan()

      // 저장 섹션 헤더 자체가 없거나, 있어도 중복서버는 스캔 줄에만 표시
      expect(screen.queryByText('저장된 서버')).not.toBeInTheDocument()
    })
  })
})

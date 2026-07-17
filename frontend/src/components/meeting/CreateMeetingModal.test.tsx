import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateMeetingModal } from './CreateMeetingModal'
import { useFolderStore } from '../../stores/folderStore'
import { useProjectStore } from '../../stores/projectStore'
import { useToastStore } from '../../stores/toastStore'

const { mockCreateMeeting, mockGetMeetings } = vi.hoisted(() => ({
  mockCreateMeeting: vi.fn(),
  mockGetMeetings: vi.fn(),
}))

vi.mock('../../api/meetings', async () => ({
  ...(await vi.importActual<typeof import('../../api/meetings')>('../../api/meetings')),
  createMeeting: mockCreateMeeting,
  getMeetings: mockGetMeetings,
}))

vi.mock('../../api/meetingTemplates', () => ({
  getMeetingTemplates: vi.fn().mockResolvedValue([]),
}))

// 도메인 파일 API — DomainFilesPanel.test.tsx의 mock 패턴 참고. 기본은 빈 응답이라
// 도메인 파일과 무관한 기존 테스트(예약/반복/제목)에는 영향을 주지 않는다.
vi.mock('../../api/domainFiles', () => ({
  listDomainFiles: vi.fn(async () => ({ domain_files: [] })),
  getFolderDomainFiles: vi.fn(async () => ({ domain_files: [], inherited: [] })),
  getProjectDomainFiles: vi.fn(async () => ({ domain_files: [] })),
  setMeetingDomainFiles: vi.fn(async () => ({ selected: [], inherited: [], excluded: [] })),
}))

const meetingTypeList = [
  { value: 'general', label: '일반' },
  { value: 'standup', label: '스탠드업' },
]

function renderModal(onCreated = vi.fn(), onClose = vi.fn()) {
  return render(
    <CreateMeetingModal
      folderId={null}
      meetingTypeList={meetingTypeList}
      onClose={onClose}
      onCreated={onCreated}
    />,
  )
}

// 예약 토글: 기본 OFF. 켜면 날짜/시각/시작방식/반복 컨트롤이 노출되고 날짜는 오늘로 기본 채움.
function enableSchedule() {
  fireEvent.click(screen.getByLabelText('예약 시작'))
}

function setDate(value: string) {
  fireEvent.change(screen.getByLabelText('예약 날짜'), { target: { value } })
}

// 로컬 오늘(YYYY-MM-DD) — 컴포넌트의 기본 날짜 계산과 동일하게 로컬 기준으로 만든다.
function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('CreateMeetingModal 예약 시각', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMeetings.mockResolvedValue({ meetings: [], meta: { total: 0, page: 1, per: 100 } })
    mockCreateMeeting.mockResolvedValue({ id: 4, title: '새 회의', scheduled_start_time: null })
  })

  it('기본(토글 OFF)에서는 예약 토글만 보이고 날짜/시각/시작방식 컨트롤은 렌더링되지 않는다', () => {
    renderModal()
    expect(screen.getByLabelText('예약 시작')).toBeInTheDocument()
    expect(screen.queryByLabelText('예약 날짜')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('시')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('분')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('자동')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('수동')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('반복')).not.toBeInTheDocument()
  })

  it('예약 토글을 켜면 날짜(오늘로 채움)/시각/시작방식 라디오가 노출되고 기본은 수동', () => {
    renderModal()
    enableSchedule()

    const date = screen.getByLabelText('예약 날짜') as HTMLInputElement
    expect(date).toBeInTheDocument()
    // 날짜는 절대 비어 있지 않다 — 오늘로 기본 채움
    expect(date.value).toBe(todayLocal())
    expect(screen.getByLabelText('시')).toBeInTheDocument()
    expect(screen.getByLabelText('분')).toBeInTheDocument()

    const auto = screen.getByLabelText('자동') as HTMLInputElement
    const manual = screen.getByLabelText('수동') as HTMLInputElement
    expect(auto).toBeInTheDocument()
    expect(manual).toBeInTheDocument()
    // 기본값 = 수동 (안전)
    expect(manual.checked).toBe(true)
    expect(auto.checked).toBe(false)
  })

  it('시/분 기본값은 09:00 이고 옵션은 zero-pad 된 24시간 형식, 분은 1분 단위', () => {
    renderModal()
    enableSchedule()
    const hour = screen.getByLabelText('시') as HTMLSelectElement
    const minute = screen.getByLabelText('분') as HTMLSelectElement
    expect(hour.value).toBe('09')
    expect(minute.value).toBe('00')
    // 24시간: 00..23 (12h "오후" 없음)
    const hourOptions = Array.from(hour.options).map((o) => o.value)
    expect(hourOptions[0]).toBe('00')
    expect(hourOptions).toContain('23')
    expect(hourOptions).not.toContain('24')
    // 분: 1분 단위 00..59 (60개), 임의 분(37)도 선택 가능
    const minuteOptions = Array.from(minute.options).map((o) => o.value)
    expect(minuteOptions).toHaveLength(60)
    expect(minuteOptions[0]).toBe('00')
    expect(minuteOptions).toContain('37')
    expect(minuteOptions).toContain('59')
    expect(minuteOptions).not.toContain('60')
  })

  it('예약 토글을 켜고 날짜+시각을 지정하고 제출하면 scheduled_start_time(ISO)+auto_start_mode를 전달한다', async () => {
    const onCreated = vi.fn()
    renderModal(onCreated)

    await userEvent.type(screen.getByPlaceholderText(/회의 제목/i), '예약 회의')
    enableSchedule()
    setDate('2026-06-25')
    fireEvent.change(screen.getByLabelText('시'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('분'), { target: { value: '00' } })
    await userEvent.click(screen.getByLabelText('자동'))
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockCreateMeeting).toHaveBeenCalled())
    const arg = mockCreateMeeting.mock.calls[0][0]
    // 타임존 의존을 피하려고 하드코딩 대신 동일 입력으로 기대값을 계산
    expect(arg.scheduled_start_time).toBe(new Date('2026-06-25T10:00').toISOString())
    expect(arg.scheduled_start_time).toMatch(/T.*Z$/)
    expect(arg.auto_start_mode).toBe('auto')
  })

  it('예약 토글만 켜고 시각 미변경 시 오늘 09:00 + 기본 manual로 전달한다', async () => {
    renderModal()

    await userEvent.type(screen.getByPlaceholderText(/회의 제목/i), '예약 회의')
    enableSchedule()
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockCreateMeeting).toHaveBeenCalled())
    const arg = mockCreateMeeting.mock.calls[0][0]
    expect(arg.auto_start_mode).toBe('manual')
    // 날짜는 오늘로 기본 채움 → 시/분 미변경 → 오늘 09:00
    expect(arg.scheduled_start_time).toBe(new Date(`${todayLocal()}T09:00`).toISOString())
  })

  it('예약 토글 OFF(기본)면 예약 키 없이 기존 그대로 생성한다', async () => {
    renderModal()

    const titleInput = screen.getByPlaceholderText(/회의 제목/i)
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, '즉시 회의')
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockCreateMeeting).toHaveBeenCalled())
    const arg = mockCreateMeeting.mock.calls[0][0]
    // not.objectContaining은 undefined도 통과하므로 not.toHaveProperty로 엄격 검증
    expect(arg).not.toHaveProperty('scheduled_start_time')
    expect(arg).not.toHaveProperty('auto_start_mode')
    expect(arg).not.toHaveProperty('recurrence_rule')
    expect(arg.title).toBe('즉시 회의')
  })

  it('예약 토글을 켰다가 다시 끄면 예약 키를 전달하지 않는다(일반 회의)', async () => {
    renderModal()

    await userEvent.type(screen.getByPlaceholderText(/회의 제목/i), '즉시 회의')
    enableSchedule()
    // 자동까지 골라본 뒤 토글을 다시 끈다
    await userEvent.click(screen.getByLabelText('자동'))
    await userEvent.click(screen.getByLabelText('예약 시작')) // OFF
    // 토글이 꺼지면 컨트롤은 사라진다
    expect(screen.queryByLabelText('예약 날짜')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockCreateMeeting).toHaveBeenCalled())
    const arg = mockCreateMeeting.mock.calls[0][0]
    expect(arg).not.toHaveProperty('auto_start_mode')
    expect(arg).not.toHaveProperty('scheduled_start_time')
    expect(arg).not.toHaveProperty('recurrence_rule')
  })
})

describe('CreateMeetingModal 반복(recurrence)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMeetings.mockResolvedValue({ meetings: [], meta: { total: 0, page: 1, per: 100 } })
    mockCreateMeeting.mockResolvedValue({ id: 5, title: '반복 회의', scheduled_start_time: null })
  })

  it('예약 토글 OFF면 반복 체크박스가 보이지 않는다', () => {
    renderModal()
    expect(screen.queryByLabelText('반복')).not.toBeInTheDocument()
  })

  it('예약 토글을 켜면 반복 체크박스가 노출되고, 체크하면 요일 체크박스가 보인다', () => {
    renderModal()
    enableSchedule()

    const recurringToggle = screen.getByLabelText('반복')
    expect(recurringToggle).toBeInTheDocument()
    // 체크 전에는 요일 체크박스 미노출
    expect(screen.queryByLabelText('월')).not.toBeInTheDocument()

    fireEvent.click(recurringToggle)
    expect(screen.getByLabelText('일')).toBeInTheDocument()
    expect(screen.getByLabelText('월')).toBeInTheDocument()
    expect(screen.getByLabelText('토')).toBeInTheDocument()
  })

  it('반복 + 요일 선택 시 recurrence_rule(freq/days/time/tz)을 전달한다', async () => {
    renderModal()

    await userEvent.type(screen.getByPlaceholderText(/회의 제목/i), '반복 회의')
    enableSchedule()
    setDate('2026-06-25')
    fireEvent.change(screen.getByLabelText('시'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('분'), { target: { value: '30' } })
    await userEvent.click(screen.getByLabelText('반복'))
    await userEvent.click(screen.getByLabelText('월')) // days 1
    await userEvent.click(screen.getByLabelText('수')) // days 3
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockCreateMeeting).toHaveBeenCalled())
    const arg = mockCreateMeeting.mock.calls[0][0]
    expect(arg.recurrence_rule).toEqual({
      freq: 'weekly',
      days: [1, 3],
      time: '10:30',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  })

  it('반복 체크해도 요일을 하나도 안 고르면 recurrence_rule 을 전달하지 않는다(1회성)', async () => {
    renderModal()

    await userEvent.type(screen.getByPlaceholderText(/회의 제목/i), '반복 회의')
    enableSchedule()
    await userEvent.click(screen.getByLabelText('반복'))
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockCreateMeeting).toHaveBeenCalled())
    const arg = mockCreateMeeting.mock.calls[0][0]
    expect(arg).not.toHaveProperty('recurrence_rule')
  })

  it('반복을 체크하지 않으면 recurrence_rule 을 전달하지 않는다', async () => {
    renderModal()

    await userEvent.type(screen.getByPlaceholderText(/회의 제목/i), '예약 회의')
    enableSchedule()
    setDate('2026-06-25')
    fireEvent.change(screen.getByLabelText('시'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('분'), { target: { value: '00' } })
    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockCreateMeeting).toHaveBeenCalled())
    const arg = mockCreateMeeting.mock.calls[0][0]
    expect(arg).not.toHaveProperty('recurrence_rule')
    expect(arg.scheduled_start_time).toBe(new Date('2026-06-25T10:00').toISOString())
  })
})

describe('CreateMeetingModal 제목 자동 날짜 입력', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMeetings.mockResolvedValue({ meetings: [], meta: { total: 0, page: 1, per: 100 } })
    mockCreateMeeting.mockResolvedValue({ id: 6, title: '자동 제목', scheduled_start_time: null })
  })

  it('모달을 열면 제목에 현재 시각 날짜 라벨이 자동 입력된다', () => {
    renderModal()
    const titleInput = screen.getByPlaceholderText(/회의 제목/i) as HTMLInputElement
    expect(titleInput.value).toMatch(/^\d{4}\.\d{2}\.\d{2} \d{2}시\d{2}분$/)
  })

  it('예약 시각을 지정하면 제목이 그 시각 라벨로 바뀐다', () => {
    renderModal()
    enableSchedule()
    setDate('2026-07-05')
    fireEvent.change(screen.getByLabelText('시'), { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('분'), { target: { value: '30' } })
    const titleInput = screen.getByPlaceholderText(/회의 제목/i) as HTMLInputElement
    expect(titleInput.value).toBe('2026.07.05 14시30분')
  })

  it('제목을 직접 입력하면 예약 시각을 바꿔도 제목이 유지된다', async () => {
    renderModal()
    const titleInput = screen.getByPlaceholderText(/회의 제목/i)
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, '내 커스텀 회의')
    enableSchedule()
    setDate('2026-07-05')
    fireEvent.change(screen.getByLabelText('시'), { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('분'), { target: { value: '30' } })
    expect((titleInput as HTMLInputElement).value).toBe('내 커스텀 회의')
  })

  it('제목칸에 포커스하면 자동 날짜 라벨 전체가 선택된다(타이핑 시 교체용)', () => {
    renderModal()
    const titleInput = screen.getByPlaceholderText(/회의 제목/i) as HTMLInputElement
    fireEvent.focus(titleInput)
    expect(titleInput.value.length).toBeGreaterThan(0)
    expect(titleInput.selectionStart).toBe(0)
    expect(titleInput.selectionEnd).toBe(titleInput.value.length)
  })
})

describe('CreateMeetingModal 도메인 파일', () => {
  const folderNode = {
    id: 7, name: '테스트 폴더', parent_id: null, position: 0,
    shared: true, important: false, meeting_count: 0, tags: [], children: [],
  }
  const testProject = {
    id: 5, name: '반도체 프로젝트', description: null, icon_type: null, icon_value: null,
    color: null, personal: false, role: 'member' as const, member_count: 1, meeting_count: 0, owner: null,
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetMeetings.mockResolvedValue({ meetings: [], meta: { total: 0, page: 1, per: 100 } })
    mockCreateMeeting.mockResolvedValue({ id: 10, title: '새 회의', scheduled_start_time: null })
    useFolderStore.setState({ folders: [] })
    useProjectStore.setState({ currentProjectId: null, projects: [] })
    useToastStore.setState({ message: '' })
  })

  it('대상 폴더에 지정된 파일 + 상속분을 읽기전용 칩으로 보여준다', async () => {
    useFolderStore.setState({ folders: [folderNode] })
    const api = await import('../../api/domainFiles')
    vi.mocked(api.getFolderDomainFiles).mockResolvedValueOnce({
      domain_files: [{ id: 1, name: '폴더 지정 파일', project_id: null, updated_at: '', editable: true }],
      inherited: [
        { id: 2, name: '상속 파일', project_id: 5, updated_at: '', editable: false, source: 'project', owner_name: '반도체 프로젝트' },
      ],
    })

    render(<CreateMeetingModal folderId={7} meetingTypeList={meetingTypeList} onClose={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('폴더 지정 파일')).toBeInTheDocument())
    expect(screen.getByText('폴더: 테스트 폴더')).toBeInTheDocument()
    expect(screen.getByText('상속 파일')).toBeInTheDocument()
    expect(screen.getByText('프로젝트: 반도체 프로젝트')).toBeInTheDocument()
  })

  it('대상 폴더가 없으면 프로젝트에 지정된 파일만 읽기전용 칩으로 보여준다', async () => {
    useProjectStore.setState({ currentProjectId: 5, projects: [testProject] })
    const api = await import('../../api/domainFiles')
    vi.mocked(api.getProjectDomainFiles).mockResolvedValueOnce({
      domain_files: [{ id: 1, name: '프로젝트 지정 파일', project_id: 5, updated_at: '', editable: true }],
    })

    render(<CreateMeetingModal folderId={null} meetingTypeList={meetingTypeList} onClose={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('프로젝트 지정 파일')).toBeInTheDocument())
    expect(screen.getByText('프로젝트: 반도체 프로젝트')).toBeInTheDocument()
    expect(api.getFolderDomainFiles).not.toHaveBeenCalled()
  })

  it('회의 전용 파일을 추가 선택하고 생성하면 회의 생성 후 setMeetingDomainFiles를 호출한다', async () => {
    const api = await import('../../api/domainFiles')
    vi.mocked(api.listDomainFiles).mockResolvedValueOnce({
      domain_files: [{ id: 3, name: '추가 파일', project_id: null, created_by_id: 1, content_chars: 10, updated_at: '', editable: true }],
    })

    render(<CreateMeetingModal folderId={null} meetingTypeList={meetingTypeList} onClose={vi.fn()} onCreated={vi.fn()} />)

    await userEvent.click(screen.getByText('파일 선택'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '추가 파일' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('checkbox', { name: '추가 파일' }))
    await userEvent.click(screen.getByRole('button', { name: '확인' }))

    // 확인 후 모달이 닫히고 선택 칩이 남는다
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: '추가 파일' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('추가 파일 제거')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(mockCreateMeeting).toHaveBeenCalled())
    await waitFor(() => expect(api.setMeetingDomainFiles).toHaveBeenCalledWith(10, [3]))
  })

  it('도메인 파일 연결에 실패해도 회의 생성은 성공 처리하고 경고 토스트를 남긴다', async () => {
    const api = await import('../../api/domainFiles')
    vi.mocked(api.listDomainFiles).mockResolvedValueOnce({
      domain_files: [{ id: 3, name: '추가 파일', project_id: null, created_by_id: 1, content_chars: 10, updated_at: '', editable: true }],
    })
    vi.mocked(api.setMeetingDomainFiles).mockRejectedValueOnce(new Error('실패'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onCreated = vi.fn()
    const onClose = vi.fn()

    render(<CreateMeetingModal folderId={null} meetingTypeList={meetingTypeList} onClose={onClose} onCreated={onCreated} />)

    await userEvent.click(screen.getByText('파일 선택'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '추가 파일' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('checkbox', { name: '추가 파일' }))
    await userEvent.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(screen.getByLabelText('추가 파일 제거')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /^생성$/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    expect(useToastStore.getState().message).toContain('도메인 파일')

    warnSpy.mockRestore()
  })
})

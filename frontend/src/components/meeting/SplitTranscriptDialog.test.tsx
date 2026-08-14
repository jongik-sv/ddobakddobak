import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HTTPError } from 'ky'
import { SplitTranscriptDialog, tokenizeWords, utf16ToCodepointIndex } from './SplitTranscriptDialog'
import type { Transcript } from '../../api/meetings'

vi.mock('../../api/meetings', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return {
    ...actual,
    splitTranscript: vi.fn(),
    updateTranscriptSpeaker: vi.fn(),
    getTranscripts: vi.fn(async () => [] as Transcript[]),
  }
})

vi.mock('../../api/speakers', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return {
    ...actual,
    getSpeakers: vi.fn(async () => [
      { id: 'A', name: 'A' },
      { id: 'B', name: 'B' },
    ]),
  }
})

import { splitTranscript, updateTranscriptSpeaker, getTranscripts } from '../../api/meetings'
import { getSpeakers } from '../../api/speakers'

function makeHttpError(status: number, body: unknown): HTTPError {
  const response = new Response(JSON.stringify(body), { status })
  const request = new Request('http://localhost/api')
  // options는 HTTPError 생성자 내부에서 그대로 저장만 되고 로직에 쓰이지 않는다.
  return new HTTPError(response, request, {} as never)
}

const baseTranscript: Transcript = {
  id: 1,
  speaker_label: 'A',
  speaker_name: null,
  content: '안녕하세요 반갑습니다',
  started_at_ms: 0,
  ended_at_ms: 2000,
  sequence_number: 1,
  applied_to_minutes: false,
}

function renderDialog(overrides: Partial<Transcript> = {}, currentTimeMs = 0) {
  const onClose = vi.fn()
  const onSplit = vi.fn()
  const onSpeakerUpdated = vi.fn()
  render(
    <SplitTranscriptDialog
      meetingId={5}
      transcript={{ ...baseTranscript, ...overrides }}
      currentTimeMs={currentTimeMs}
      clientId="client-1"
      onClose={onClose}
      onSplit={onSplit}
      onSpeakerUpdated={onSpeakerUpdated}
    />,
  )
  return { onClose, onSplit, onSpeakerUpdated }
}

/** 기본 모드("화자만 변경")에서 "발언 분할" 탭으로 전환한 뒤 첫 단어 경계를 고른다. */
async function selectFirstBoundary() {
  await waitFor(() => expect(getSpeakers).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('tab', { name: '발언 분할' }))
  const boundary = screen.getByLabelText('분할 지점: "안녕하세요" 뒤')
  fireEvent.click(boundary)
  return boundary
}

function setMsText(text: string) {
  const input = screen.getByPlaceholderText('mm:ss.mmm')
  fireEvent.change(input, { target: { value: text } })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSpeakers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 'A', name: 'A' },
    { id: 'B', name: 'B' },
  ])
  ;(getTranscripts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

describe('SplitTranscriptDialog', () => {
  it('단어 경계 클릭 → 해당 문자 인덱스가 split_index로, expected_content가 원문 그대로 전송된다', async () => {
    ;(splitTranscript as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      updated: { ...baseTranscript, content: '안녕하세요', ended_at_ms: 1000 },
      inserted: { ...baseTranscript, id: 2, content: '반갑습니다', started_at_ms: 1000, sequence_number: 2 },
    })
    renderDialog()
    await selectFirstBoundary()
    setMsText('00:01.000')

    const saveButton = screen.getByRole('button', { name: '분할 저장' })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => expect(splitTranscript).toHaveBeenCalled())
    expect(splitTranscript).toHaveBeenCalledWith(5, 1, {
      split_ms: 1000,
      split_index: 5,
      expected_content: '안녕하세요 반갑습니다',
      first: { speaker_label: 'A', speaker_name: null },
      second: { speaker_label: 'A', speaker_name: null },
      client_id: 'client-1',
    })
  })

  it('"현재 재생 위치 사용" 클릭 시 currentTimeMs를 채택한다', async () => {
    renderDialog({}, 1500)
    await waitFor(() => expect(getSpeakers).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('tab', { name: '발언 분할' }))
    fireEvent.click(screen.getByRole('button', { name: '현재 재생 위치 사용' }))
    expect(screen.getByPlaceholderText('mm:ss.mmm')).toHaveValue('00:01.500')
  })

  it('범위 밖 ms는 거부되어 저장이 비활성화된다', async () => {
    renderDialog()
    await selectFirstBoundary()
    setMsText('00:05.000') // ended_at_ms=2000 밖
    expect(screen.getByRole('button', { name: '분할 저장' })).toBeDisabled()
  })

  it('양 끝 경계(started_at_ms/ended_at_ms 정확히 일치) 선택 시 저장이 비활성화된다', async () => {
    renderDialog()
    await selectFirstBoundary()
    setMsText('00:02.000') // ended_at_ms와 정확히 일치(배제 경계)
    expect(screen.getByRole('button', { name: '분할 저장' })).toBeDisabled()

    setMsText('00:00.000') // started_at_ms와 정확히 일치(배제 경계)
    expect(screen.getByRole('button', { name: '분할 저장' })).toBeDisabled()
  })

  it('프리뷰에 두 조각의 텍스트가 표시된다', async () => {
    renderDialog()
    await selectFirstBoundary()
    setMsText('00:01.000')
    // 편집 영역의 단어 토큰 + 프리뷰 박스 양쪽에 나타나므로 최소 1개 이상 존재만 확인한다.
    expect(screen.getAllByText('안녕하세요').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('반갑습니다').length).toBeGreaterThanOrEqual(1)
    // 프리뷰 ms 범위 표기(00:01.000 경계 양쪽)가 렌더되었는지로 프리뷰 블록 존재를 확정한다.
    expect(screen.getAllByText(/00:01\.000/).length).toBeGreaterThanOrEqual(1)
  })

  it('409 응답 시 안내 메시지를 표시하고 다이얼로그를 최신 내용으로 리셋한다', async () => {
    ;(splitTranscript as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      makeHttpError(409, { error: '다른 곳에서 이 발언이 수정되었습니다. 다시 시도하세요.' }),
    )
    ;(getTranscripts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...baseTranscript, content: '완전히 다른 최신 내용' },
    ])
    renderDialog()
    await selectFirstBoundary()
    setMsText('00:01.000')
    fireEvent.click(screen.getByRole('button', { name: '분할 저장' }))

    await waitFor(() =>
      expect(screen.getByText('다른 곳에서 이 발언이 수정되었습니다. 다시 시도하세요.')).toBeInTheDocument(),
    )
    // 리셋된 최신 내용이 화면에 반영됨 (기존 토큰 대신 새 content 기준으로 재렌더)
    await waitFor(() => expect(screen.getByText('완전히')).toBeInTheDocument())
  })

  it('422 등 기타 오류는 서버 메시지를 그대로 보여준다', async () => {
    ;(splitTranscript as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      makeHttpError(422, { error: 'split produces blank content' }),
    )
    renderDialog()
    await selectFirstBoundary()
    setMsText('00:01.000')
    fireEvent.click(screen.getByRole('button', { name: '분할 저장' }))

    await waitFor(() => expect(screen.getByText('split produces blank content')).toBeInTheDocument())
  })

  it('서로게이트 쌍(이모지)이 포함된 원문에서도 split_index가 코드포인트 인덱스로 전송된다', async () => {
    // "가나😀" = 코드포인트 3개(가,나,😀)지만 UTF-16으로는 4유닛(😀이 서로게이트 쌍).
    // 경계 클릭이 주는 UTF-16 인덱스(4)를 그대로 보내면 Ruby String#[](코드포인트 기준)와
    // 어긋나 서버가 이모지 중간에서 자르게 된다 — split_index는 반드시 3이어야 한다.
    ;(splitTranscript as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      updated: { ...baseTranscript, content: '가나😀' },
      inserted: { ...baseTranscript, id: 3, content: '다라' },
    })
    renderDialog({ content: '가나😀 다라', ended_at_ms: 2000 })
    await waitFor(() => expect(getSpeakers).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('tab', { name: '발언 분할' }))
    fireEvent.click(screen.getByLabelText('분할 지점: "가나😀" 뒤'))
    setMsText('00:01.000')
    fireEvent.click(screen.getByRole('button', { name: '분할 저장' }))

    await waitFor(() => expect(splitTranscript).toHaveBeenCalled())
    expect(splitTranscript).toHaveBeenCalledWith(
      5,
      1,
      expect.objectContaining({ split_index: 3, expected_content: '가나😀 다라' }),
    )
  })

  it('409 후 재조회까지 실패하면(대상 행을 못 찾으면) 재진입 안내를 띄우고 저장을 계속 비활성화한다', async () => {
    ;(splitTranscript as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      makeHttpError(409, { error: '다른 곳에서 이 발언이 수정되었습니다. 다시 시도하세요.' }),
    )
    // getTranscripts는 내부적으로 실패를 삼켜 []를 반환한다(api/meetings/transcripts.ts) —
    // "재조회 실패"는 실제로 이 형태(대상 행을 못 찾음)로 나타난다.
    ;(getTranscripts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([])
    renderDialog()
    await selectFirstBoundary()
    setMsText('00:01.000')
    fireEvent.click(screen.getByRole('button', { name: '분할 저장' }))

    await waitFor(() =>
      expect(screen.getByText('최신 내용을 불러오지 못했습니다. 창을 닫고 다시 열어주세요.')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: '분할 저장' })).toBeDisabled()

    // 재선택해도(유효한 입력이어도) 계속 비활성화 — 무한 409 루프에 갇히지 않아야 한다.
    fireEvent.click(screen.getByLabelText('분할 지점: "안녕하세요" 뒤'))
    setMsText('00:01.500')
    expect(screen.getByRole('button', { name: '분할 저장' })).toBeDisabled()
  })

  it('409 후 getTranscripts 자체가 reject해도(방어적 .catch) 동일하게 재진입을 안내한다', async () => {
    ;(splitTranscript as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(makeHttpError(409, {}))
    ;(getTranscripts as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))
    renderDialog()
    await selectFirstBoundary()
    setMsText('00:01.000')
    fireEvent.click(screen.getByRole('button', { name: '분할 저장' }))

    await waitFor(() =>
      expect(screen.getByText('최신 내용을 불러오지 못했습니다. 창을 닫고 다시 열어주세요.')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: '분할 저장' })).toBeDisabled()
  })
})

describe('SplitTranscriptDialog 화자만 변경 모드', () => {
  it('기본 모드는 "화자만 변경"이며 분할 UI는 보이지 않는다', async () => {
    renderDialog()
    await waitFor(() => expect(getSpeakers).toHaveBeenCalled())

    expect(screen.getByRole('tab', { name: '화자만 변경' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByPlaceholderText('mm:ss.mmm')).not.toBeInTheDocument()
    expect(screen.queryByText('텍스트 분할 지점')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '변경 저장' })).toBeInTheDocument()
  })

  it('화자를 바꾸고 저장하면 updateTranscriptSpeaker가 호출되고 onSpeakerUpdated가 결과로 호출된다', async () => {
    const updated = { ...baseTranscript, speaker_label: 'B', speaker_name: null }
    ;(updateTranscriptSpeaker as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(updated)

    const { onSpeakerUpdated, onSplit } = renderDialog()
    await waitFor(() => expect(getSpeakers).toHaveBeenCalled())

    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'B' } })
    const saveButton = screen.getByRole('button', { name: '변경 저장' })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => expect(updateTranscriptSpeaker).toHaveBeenCalled())
    expect(updateTranscriptSpeaker).toHaveBeenCalledWith(5, 1, {
      speaker_label: 'B',
      speaker_name: null,
      client_id: 'client-1',
    })
    await waitFor(() => expect(onSpeakerUpdated).toHaveBeenCalledWith(updated))
    expect(onSplit).not.toHaveBeenCalled()
  })

  it('공백 화자 라벨은 저장을 비활성화한다', async () => {
    renderDialog()
    await waitFor(() => expect(getSpeakers).toHaveBeenCalled())

    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: '__custom__' } })
    fireEvent.change(screen.getByPlaceholderText('화자 ID (예: SPEAKER_02)'), { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: '변경 저장' })).toBeDisabled()
  })

  it('서버 오류(422 등)는 메시지를 그대로 보여준다', async () => {
    ;(updateTranscriptSpeaker as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      makeHttpError(422, { error: 'speaker_label을 입력하세요' }),
    )
    renderDialog()
    await waitFor(() => expect(getSpeakers).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }))

    await waitFor(() => expect(screen.getByText('speaker_label을 입력하세요')).toBeInTheDocument())
  })

  it('"발언 분할" 탭으로 전환하면 기존 분할 UI가 그대로 노출된다', async () => {
    renderDialog()
    await selectFirstBoundary()

    expect(screen.getByText('텍스트 분할 지점')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '분할 저장' })).toBeInTheDocument()
  })
})

describe('tokenizeWords / utf16ToCodepointIndex — 서로게이트 쌍(이모지) 단위 테스트', () => {
  const content = '가나😀 다라'

  it('tokenizeWords가 서로게이트 쌍을 깨지 않고 한 단어로 묶는다', () => {
    const tokens = tokenizeWords(content)
    expect(tokens).toEqual([
      { text: '가나😀', start: 0, end: 4 },
      { text: '다라', start: 5, end: 7 },
    ])
  })

  it('utf16ToCodepointIndex가 서로게이트 쌍 이후 UTF-16 인덱스를 코드포인트 인덱스로 변환한다', () => {
    // "가나😀" 뒤 UTF-16 인덱스는 4지만(😀이 2유닛), 코드포인트로는 3(가,나,😀 각 1개)이어야
    // Ruby String#[](content[0...split_index])와 같은 지점을 가리킨다.
    expect(utf16ToCodepointIndex(content, 4)).toBe(3)
    // 대조: 변환 없이 UTF-16 인덱스를 그대로 반환했다면 4가 나왔을 것이다.
    expect(utf16ToCodepointIndex(content, 4)).not.toBe(4)
  })

  it('BMP(한글)만 있으면 UTF-16 인덱스와 코드포인트 인덱스가 같다(회귀 방지: 변환 자체가 no-op인 흔한 케이스)', () => {
    expect(utf16ToCodepointIndex('안녕하세요 반갑습니다', 5)).toBe(5)
  })
})

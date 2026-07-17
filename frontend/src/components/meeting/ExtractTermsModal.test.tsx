import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExtractTermsModal from './ExtractTermsModal'
import type { DomainFile, ExtractedTerm } from '../../api/domainFiles'

vi.mock('../../api/domainFiles', () => ({
  createDomainFile: vi.fn(async () => ({ domain_file: { id: 9, name: '새 파일', project_id: null, created_by_id: 1, content_chars: 0, updated_at: '', content: '' } })),
  mergeDomainTerms: vi.fn(async () => ({ domain_file: { id: 1, name: '공정 용어집', project_id: null, created_by_id: 1, content_chars: 0, updated_at: '', content: '' }, added: 1, replaced: 0 })),
}))

vi.mock('../../api/glossary', () => ({
  createMeetingGlossaryEntry: vi.fn(async () => ({ entry: { id: 1, from_text: 'ㅔㅣㅔㅁ', to_text: 'APM', match_type: 'literal', enabled: true, owner_type: 'Meeting', owner_id: 1 } })),
}))

const terms: ExtractedTerm[] = [
  { term: 'APM', category: '약어', definition: '자동화 공정 모니터링', mispronunciations: ['에이피엠'] },
  { term: '라인A', category: '', definition: '1공장 조립라인', mispronunciations: [] },
]

const files: DomainFile[] = [
  { id: 1, name: '공정 용어집', project_id: null, created_by_id: 1, content_chars: 10, updated_at: '2026-01-01T00:00:00Z' },
]

describe('ExtractTermsModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('모든 용어 행을 체크된 상태로 보여준다', async () => {
    render(<ExtractTermsModal meetingId={1} terms={terms} files={files} onClose={vi.fn()} onMerged={vi.fn()} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    checkboxes.forEach((cb) => expect(cb).toBeChecked())
  })

  it('행 체크 해제 + 분류 수정 후 기존 파일에 병합한다', async () => {
    const api = await import('../../api/domainFiles')
    const onMerged = vi.fn()
    render(<ExtractTermsModal meetingId={1} terms={terms} files={files} onClose={vi.fn()} onMerged={onMerged} />)

    // 두 번째 행(라인A) 체크 해제
    const checkboxes = screen.getAllByRole('checkbox')
    await userEvent.click(checkboxes[1])

    // 첫 번째 행 분류 수정
    const categoryInputs = screen.getAllByPlaceholderText('분류')
    await userEvent.clear(categoryInputs[0])
    await userEvent.type(categoryInputs[0], '시스템명')

    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(api.mergeDomainTerms).toHaveBeenCalledWith(1, [
      { term: 'APM', category: '시스템명', definition: '자동화 공정 모니터링', mispronunciations: ['에이피엠'] },
    ]))
    await waitFor(() => expect(onMerged).toHaveBeenCalled())
  })

  it('새 파일로 저장을 선택하면 createDomainFile을 라인 포맷 content로 호출한다', async () => {
    const api = await import('../../api/domainFiles')
    const onMerged = vi.fn()
    render(<ExtractTermsModal meetingId={1} terms={terms} files={files} onClose={vi.fn()} onMerged={onMerged} />)

    await userEvent.click(screen.getByRole('radio', { name: '새 파일로 저장' }))
    await userEvent.type(screen.getByPlaceholderText('새 파일 이름'), '신규 용어집')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(api.createDomainFile).toHaveBeenCalledWith({
      name: '신규 용어집',
      content: '- **APM** [약어] (오인식: 에이피엠): 자동화 공정 모니터링\n- **라인A**: 1공장 조립라인',
    }))
    await waitFor(() => expect(onMerged).toHaveBeenCalled())
  })

  it('행별 [교정 추가]로 오타사전 등록을 호출한다', async () => {
    const glossaryApi = await import('../../api/glossary')
    render(<ExtractTermsModal meetingId={7} terms={terms} files={files} onClose={vi.fn()} onMerged={vi.fn()} />)

    const addButtons = screen.getAllByRole('button', { name: '교정 추가' })
    await userEvent.click(addButtons[0])
    const input = screen.getByPlaceholderText('잘못 인식되는 표기')
    await userEvent.clear(input)
    await userEvent.type(input, 'ㅔㅣㅔㅁ')
    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(glossaryApi.createMeetingGlossaryEntry).toHaveBeenCalledWith(7, { from_text: 'ㅔㅣㅔㅁ', to_text: 'APM' }))
  })

  it('행의 오인식 편집 컬럼을 수정하면 저장 시 배열로 변환되어 전달된다', async () => {
    const api = await import('../../api/domainFiles')
    const onMerged = vi.fn()
    render(<ExtractTermsModal meetingId={1} terms={terms} files={files} onClose={vi.fn()} onMerged={onMerged} />)

    const misInputs = screen.getAllByPlaceholderText('오인식 변형(쉼표로 구분, 예: 씨지엘, 시지엘)')
    expect((misInputs[0] as HTMLInputElement).value).toBe('에이피엠')

    // 두 번째 행(라인A) 체크 해제해 첫 행만 병합 대상으로 남긴다
    const checkboxes = screen.getAllByRole('checkbox')
    await userEvent.click(checkboxes[1])

    await userEvent.type(misInputs[0], ', 에이피엠2')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(api.mergeDomainTerms).toHaveBeenCalledWith(1, [
      { term: 'APM', category: '약어', definition: '자동화 공정 모니터링', mispronunciations: ['에이피엠', '에이피엠2'] },
    ]))
    await waitFor(() => expect(onMerged).toHaveBeenCalled())
  })

  it('행에 오인식 변형이 있으면 [교정 추가] 클릭 시 첫 변형으로 프리필한다', async () => {
    render(<ExtractTermsModal meetingId={1} terms={terms} files={files} onClose={vi.fn()} onMerged={vi.fn()} />)

    const addButtons = screen.getAllByRole('button', { name: '교정 추가' })
    await userEvent.click(addButtons[0]) // APM 행 — mispronunciations: ['에이피엠']

    const input = screen.getByPlaceholderText('잘못 인식되는 표기') as HTMLInputElement
    expect(input.value).toBe('에이피엠')
  })
})

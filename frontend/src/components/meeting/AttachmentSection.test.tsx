import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AttachmentSection } from './AttachmentSection'

// useAttachments / ContactsSection 는 네트워크·ActionCable 의존이라 stub.
const remove = vi.fn()
vi.mock('../../hooks/useAttachments', () => ({
  useAttachments: () => ({
    attachments: [],
    isLoading: false,
    error: null,
    addFile: vi.fn(),
    addLink: vi.fn(),
    remove,
    refetch: vi.fn(),
  }),
}))
vi.mock('./ContactsSection', () => ({
  ContactsSection: () => null,
}))

describe('AttachmentSection 잠금 게이팅', () => {
  beforeEach(() => {
    remove.mockClear()
  })

  it('readOnly=false면 파일/링크 추가 버튼이 활성', () => {
    render(<AttachmentSection meetingId={1} />)
    expect(screen.getByRole('button', { name: /파일 추가/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /링크 추가/ })).not.toBeDisabled()
  })

  it('readOnly=true면 파일/링크 추가 버튼이 disabled', () => {
    render(<AttachmentSection meetingId={1} readOnly />)
    expect(screen.getByRole('button', { name: /파일 추가/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /링크 추가/ })).toBeDisabled()
  })
})

describe('AttachmentSection 카테고리 탭', () => {
  it('이해관계자 탭이 참고자료와 명함 사이에 노출된다', () => {
    render(<AttachmentSection meetingId={1} />)
    const tabButtons = screen.getAllByRole('button').filter((btn) => /\(\d+\)$/.test(btn.textContent ?? ''))
    const labels = tabButtons.map((btn) => btn.textContent)
    const referenceIdx = labels.findIndex((l) => l?.startsWith('참고자료'))
    const stakeholderIdx = labels.findIndex((l) => l?.startsWith('이해관계자'))
    const businessCardIdx = labels.findIndex((l) => l?.startsWith('명함'))
    expect(stakeholderIdx).toBeGreaterThan(-1)
    expect(stakeholderIdx).toBeGreaterThan(referenceIdx)
    expect(stakeholderIdx).toBeLessThan(businessCardIdx)
    expect(screen.getByRole('button', { name: '이해관계자(0)' })).toBeInTheDocument()
  })
})

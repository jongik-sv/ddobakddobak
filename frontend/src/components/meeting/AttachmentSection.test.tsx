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

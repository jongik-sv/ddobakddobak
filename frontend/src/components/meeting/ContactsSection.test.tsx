import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const getContacts = vi.fn()
vi.mock('../../api/contacts', () => ({
  getContacts: (...a: unknown[]) => getContacts(...a),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
}))

// 독립 채널 구독 — 테스트에선 no-op consumer
vi.mock('../../lib/actionCableAuth', () => ({
  createAuthenticatedConsumer: () => ({
    subscriptions: { create: () => ({ unsubscribe: vi.fn() }) },
    disconnect: vi.fn(),
  }),
}))

import { ContactsSection } from './ContactsSection'

describe('ContactsSection', () => {
  beforeEach(() => getContacts.mockReset())

  it('renders recognized contacts', async () => {
    getContacts.mockResolvedValue([
      { id: 1, meeting_id: 7, name: '홍길동', company: '또박', title: '팀장',
        department: null, mobile: '010-1', phone: null, fax: null, email: 'h@x.io',
        website: null, address: null, extra: {}, raw_text: null,
        source_attachment_id: 9, created_at: '', updated_at: '' },
    ])
    render(<ContactsSection meetingId={7} />)
    expect(await screen.findByText('홍길동')).toBeInTheDocument()
    expect(screen.getByText(/또박/)).toBeInTheDocument()
  })

  it('renders nothing when there are no contacts', async () => {
    getContacts.mockResolvedValue([])
    const { container } = render(<ContactsSection meetingId={7} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).toBe('')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

const getContacts = vi.fn()
const updateContact = vi.fn()
const deleteContact = vi.fn()
vi.mock('../../api/contacts', () => ({
  getContacts: (...a: unknown[]) => getContacts(...a),
  updateContact: (...a: unknown[]) => updateContact(...a),
  deleteContact: (...a: unknown[]) => deleteContact(...a),
}))

let receivedHandler: ((d: { type?: string }) => void) | null = null
vi.mock('../../lib/actionCableAuth', () => ({
  createAuthenticatedConsumer: () => ({
    subscriptions: {
      create: (_p: unknown, handlers: { received: (d: { type?: string }) => void }) => {
        receivedHandler = handlers.received
        return { unsubscribe: vi.fn() }
      },
    },
    disconnect: vi.fn(),
  }),
}))

import { ContactsSection } from './ContactsSection'

const sampleContact = {
  id: 1, meeting_id: 7, name: '홍길동', company: '또박', title: '팀장',
  department: null, mobile: '010-1', phone: null, fax: null, email: 'h@x.io',
  website: null, address: null, extra: {}, raw_text: null,
  source_attachment_id: 9, created_at: '', updated_at: '',
}

describe('ContactsSection', () => {
  beforeEach(() => {
    getContacts.mockReset(); updateContact.mockReset(); deleteContact.mockReset()
    updateContact.mockResolvedValue({ ...sampleContact, name: '정정' })
    receivedHandler = null
  })

  it('renders recognized contacts', async () => {
    getContacts.mockResolvedValue([sampleContact])
    render(<ContactsSection meetingId={7} />)
    expect(await screen.findByText('홍길동')).toBeInTheDocument()
    expect(screen.getByText(/또박/)).toBeInTheDocument()
  })

  it('renders nothing when there are no contacts and no failure', async () => {
    getContacts.mockResolvedValue([])
    const { container } = render(<ContactsSection meetingId={8} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).toBe('')
  })

  it('shows a failure banner on card_extraction_failed even with no contacts', async () => {
    getContacts.mockResolvedValue([])
    render(<ContactsSection meetingId={9} />)
    await new Promise((r) => setTimeout(r, 0))
    act(() => { receivedHandler?.({ type: 'card_extraction_failed' }) })
    expect(await screen.findByText(/명함 인식에 실패/)).toBeInTheDocument()
  })

  it('edits a contact and calls updateContact', async () => {
    getContacts.mockResolvedValue([sampleContact])
    render(<ContactsSection meetingId={10} />)
    await screen.findByText('홍길동')
    fireEvent.click(screen.getByLabelText('수정'))
    const nameInput = screen.getByLabelText('이름')
    fireEvent.change(nameInput, { target: { value: '정정' } })
    fireEvent.click(screen.getByLabelText('저장'))
    expect(updateContact).toHaveBeenCalledWith(10, 1, expect.objectContaining({ name: '정정' }))
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TrashPage from './TrashPage'
import * as trashApi from '../api/trash'

describe('TrashPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders trashed items with restore button', async () => {
    vi.spyOn(trashApi, 'listTrash').mockResolvedValue([
      {
        type: 'meeting',
        id: 1,
        title: '회의1',
        deleted_at: '2026-06-18T00:00:00Z',
        deleted_by_id: 1,
        trash_group_id: 'g1',
      },
    ])
    render(<TrashPage />)
    await waitFor(() => expect(screen.getByText('회의1')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /복구/ })).toBeInTheDocument()
  })

  it('calls restore on button click', async () => {
    vi.spyOn(trashApi, 'listTrash').mockResolvedValue([
      {
        type: 'meeting',
        id: 1,
        title: '회의1',
        deleted_at: '2026-06-18T00:00:00Z',
        deleted_by_id: 1,
        trash_group_id: 'g1',
      },
    ])
    const restore = vi.spyOn(trashApi, 'restoreTrashItem').mockResolvedValue()
    render(<TrashPage />)
    await waitFor(() => screen.getByText('회의1'))
    fireEvent.click(screen.getByRole('button', { name: /복구/ }))
    await waitFor(() => expect(restore).toHaveBeenCalledWith('meeting', 1))
  })
})

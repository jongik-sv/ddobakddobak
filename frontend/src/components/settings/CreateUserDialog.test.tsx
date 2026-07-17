import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CreateUserDialog } from './CreateUserDialog'

vi.mock('../../api/adminUsers', () => ({
  createAdminUser: vi.fn(),
}))

describe('CreateUserDialog', () => {
  it('역할 셀렉트에 manager 옵션이 있고 선택할 수 있다', () => {
    render(<CreateUserDialog onClose={() => {}} onCreated={() => {}} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual(['member', 'manager', 'admin'])

    fireEvent.change(select, { target: { value: 'manager' } })
    expect(select.value).toBe('manager')
  })
})

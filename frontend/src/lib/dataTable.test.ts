import { describe, it, expect, beforeEach } from 'vitest'
import {
  compareText, filterRows, hasActiveFilters, loadView, nextSort, saveView, sortRows,
} from './dataTable'
import type { ColumnDef, SortState } from './dataTable'

interface R { id: number; name: string; email: string; role: 'a' | 'b'; at: string }
const cols: ColumnDef<R>[] = [
  { key: 'name', label: '이름', type: 'text', accessor: (r) => r.name },
  { key: 'email', label: '이메일', type: 'text', accessor: (r) => r.email },
  {
    key: 'role', label: '역할', type: 'select', accessor: (r) => r.role,
    sortValue: (r) => (r.role === 'a' ? 0 : 1),
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
  },
  { key: 'at', label: '생성일', type: 'date', accessor: (r) => r.at },
]
const tie = (a: R, b: R) => compareText(a.email, b.email) || a.id - b.id
const DEF: SortState = { key: 'name', dir: 'asc' }
const r = (id: number, name: string, email: string, role: R['role'] = 'b', at = '2026-01-10T12:00:00'): R =>
  ({ id, name, email, role, at })
const names = (rows: R[]) => rows.map((x) => x.name)

describe('sortRows', () => {
  const rows = [r(1, '하나', 'h@x'), r(2, '가나', 'g@x'), r(3, '', 'z@x'), r(4, 'Alice', 'a@x'), r(5, '가나', 'a2@x'), r(6, 'user10', 'u10@x'), r(7, 'user2', 'u2@x')]
  it('이름 asc: 한글 collation, 동명은 이메일, 빈 이름은 뒤, numeric', () => {
    const out = sortRows(rows, cols, DEF, tie)
    expect(out.map((x) => x.id)).toEqual([5, 2, 1, 4, 7, 6, 3])
    expect(names(out).slice(-1)).toEqual([''])
    expect(out.findIndex((x) => x.id === 5)).toBeLessThan(out.findIndex((x) => x.id === 2))
    expect(out.findIndex((x) => x.id === 7)).toBeLessThan(out.findIndex((x) => x.id === 6))
  })
  it('이름 desc 에서도 빈 이름은 뒤', () => {
    const out = sortRows(rows, cols, { key: 'name', dir: 'desc' }, tie)
    expect(names(out).slice(-1)).toEqual([''])
    expect(out[0].name).toBe('user10')
  })
  it('역할은 sortValue 순서, 날짜는 시각순', () => {
    const rs = [r(1, 'a', 'a@x', 'b'), r(2, 'b', 'b@x', 'a')]
    expect(sortRows(rs, cols, { key: 'role', dir: 'asc' }, tie).map((x) => x.id)).toEqual([2, 1])
    const ds = [r(1, 'a', 'a@x', 'a', '2026-02-01T00:00:00'), r(2, 'b', 'b@x', 'a', '2026-01-01T00:00:00')]
    expect(sortRows(ds, cols, { key: 'at', dir: 'asc' }, tie).map((x) => x.id)).toEqual([2, 1])
    expect(sortRows(ds, cols, { key: 'at', dir: 'desc' }, tie).map((x) => x.id)).toEqual([1, 2])
  })
})

describe('nextSort', () => {
  it('asc → desc → 기본, 다른 컬럼은 asc', () => {
    const a = nextSort(DEF, 'email', DEF)
    expect(a).toEqual({ key: 'email', dir: 'asc' })
    const d = nextSort(a, 'email', DEF)
    expect(d).toEqual({ key: 'email', dir: 'desc' })
    expect(nextSort(d, 'email', DEF)).toEqual(DEF)
    expect(nextSort(DEF, 'name', DEF)).toEqual({ key: 'name', dir: 'desc' })
  })
})

describe('filterRows', () => {
  const rows = [r(1, 'Alice', 'al@x.com', 'a', '2026-01-05T10:00:00'), r(2, '밥', 'bob@y.com', 'b', '2026-02-05T10:00:00')]
  it('텍스트는 대소문자 무시·trim 부분일치', () => {
    expect(filterRows(rows, cols, { name: '  ALI ' }).map((x) => x.id)).toEqual([1])
    expect(filterRows(rows, cols, { email: 'Y.COM' }).map((x) => x.id)).toEqual([2])
  })
  it('select 정확일치, date 범위(경계 포함)', () => {
    expect(filterRows(rows, cols, { role: 'b' }).map((x) => x.id)).toEqual([2])
    expect(filterRows(rows, cols, { 'at.from': '2026-02-05' }).map((x) => x.id)).toEqual([2])
    expect(filterRows(rows, cols, { 'at.to': '2026-01-05' }).map((x) => x.id)).toEqual([1])
    expect(filterRows(rows, cols, { 'at.from': '2026-01-06', 'at.to': '2026-01-31' })).toEqual([])
  })
  it('hasActiveFilters', () => {
    expect(hasActiveFilters({})).toBe(false)
    expect(hasActiveFilters({ name: ' ' })).toBe(false)
    expect(hasActiveFilters({ name: 'x' })).toBe(true)
  })
})

describe('view persistence', () => {
  beforeEach(() => localStorage.clear())
  it('저장/복원하고 잘못된 값은 기본값', () => {
    saveView('k', { sort: { key: 'email', dir: 'desc' }, filters: { name: 'x', role: 'zzz' } })
    const v = loadView('k', cols, DEF)
    expect(v.sort).toEqual({ key: 'email', dir: 'desc' })
    expect(v.filters).toEqual({ name: 'x' })
    localStorage.setItem('k', '{bad')
    expect(loadView('k', cols, DEF)).toEqual({ sort: DEF, filters: {} })
    localStorage.setItem('k', JSON.stringify({ sort: { key: 'nope', dir: 'asc' } }))
    expect(loadView('k', cols, DEF).sort).toEqual(DEF)
  })
})

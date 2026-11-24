import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import {
  filterRows,
  hasActiveFilters,
  loadView,
  nextSort,
  saveView,
  sortRows,
} from '../../lib/dataTable'
import type { ColumnDef, Filters, SortState } from '../../lib/dataTable'

interface Options<T> {
  rows: T[]
  columns: ColumnDef<T>[]
  defaultSort: SortState
  tieBreak: (a: T, b: T) => number
  storageKey: string
}

/** 정렬·필터 상태(+localStorage 복원) 와 가공된 행 목록. */
export function useTableView<T>({ rows, columns, defaultSort, tieBreak, storageKey }: Options<T>) {
  const [initial] = useState(() => loadView(storageKey, columns, defaultSort))
  const [sort, setSort] = useState<SortState>(initial.sort)
  const [filters, setFilters] = useState<Filters>(initial.filters)

  useEffect(() => {
    saveView(storageKey, { sort, filters })
  }, [storageKey, sort, filters])

  const view = useMemo(
    () => sortRows(filterRows(rows, columns, filters), columns, sort, tieBreak),
    [rows, columns, filters, sort, tieBreak],
  )
  const toggleSort = useCallback(
    (key: string) => setSort((s) => nextSort(s, key, defaultSort)),
    [defaultSort],
  )
  const setFilter = useCallback(
    (key: string, value: string) => setFilters((f) => ({ ...f, [key]: value })),
    [],
  )
  const reset = useCallback(() => setFilters({}), [])
  return { sort, filters, view, toggleSort, setFilter, reset, filtered: hasActiveFilters(filters) }
}

export function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string
  sortKey: string
  sort: SortState
  onSort: (key: string) => void
}) {
  const active = sort.key === sortKey
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <th
      scope="col"
      className="px-3 pb-1 pt-2 font-medium whitespace-nowrap"
      aria-sort={!active ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline focus-visible:outline-2"
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? 'text-foreground' : 'opacity-50'}`} aria-hidden />
      </button>
    </th>
  )
}

const FILTER_INPUT =
  'w-full min-w-[6rem] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-2 focus:ring-indigo-500'

export function FilterCell<T>({
  column,
  filters,
  onChange,
}: {
  column: ColumnDef<T>
  filters: Filters
  onChange: (key: string, value: string) => void
}) {
  if (column.type === 'date') {
    return (
      <div className="flex items-center gap-1">
        <input
          type="date"
          aria-label={`${column.label} 시작일`}
          value={filters[`${column.key}.from`] ?? ''}
          onChange={(e) => onChange(`${column.key}.from`, e.target.value)}
          className={FILTER_INPUT}
        />
        <span className="text-xs">~</span>
        <input
          type="date"
          aria-label={`${column.label} 종료일`}
          value={filters[`${column.key}.to`] ?? ''}
          onChange={(e) => onChange(`${column.key}.to`, e.target.value)}
          className={FILTER_INPUT}
        />
      </div>
    )
  }
  if (column.type === 'select') {
    return (
      <select
        aria-label={`${column.label} 필터`}
        value={filters[column.key] ?? ''}
        onChange={(e) => onChange(column.key, e.target.value)}
        className={FILTER_INPUT}
      >
        <option value="">전체</option>
        {column.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      type="text"
      aria-label={`${column.label} 필터`}
      placeholder="검색"
      value={filters[column.key] ?? ''}
      onChange={(e) => onChange(column.key, e.target.value)}
      className={FILTER_INPUT}
    />
  )
}

export function TableSummary({
  shown,
  total,
  filtered,
  onReset,
}: {
  shown: number
  total: number
  filtered: boolean
  onReset: () => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
      <span aria-live="polite">{`${shown}명 / 전체 ${total}명`}</span>
      <button
        type="button"
        onClick={onReset}
        disabled={!filtered}
        className="rounded-md px-2 py-1 hover:bg-accent disabled:opacity-40"
      >
        필터 초기화
      </button>
    </div>
  )
}

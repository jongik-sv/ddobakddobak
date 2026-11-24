// 표(테이블) 공용 정렬·필터 로직 — 사용자 관리·프로젝트 멤버 관리가 공유한다.

export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: string
  dir: SortDir
}
/** text: 부분일치 입력 / select: 정확 일치 선택 / date: 기간(from~to) */
export type ColumnType = 'text' | 'select' | 'date'

export interface ColumnDef<T> {
  key: string
  label: string
  type: ColumnType
  /** 필터·텍스트 정렬에 쓰는 문자열 값 (date 는 ISO 문자열) */
  accessor: (row: T) => string | null | undefined
  /** 지정 시 정렬은 이 숫자 값으로 (예: 역할 순서). 없으면 text=한글 collation, date=시각 */
  sortValue?: (row: T) => number
  /** select 필터의 선택지 */
  options?: { value: string; label: string }[]
}

/** 필터 값: text/select 는 `key`, date 는 `key.from` / `key.to` */
export type Filters = Record<string, string>

const collator = new Intl.Collator('ko', { sensitivity: 'base', numeric: true })
export const compareText = (a: string, b: string): number => collator.compare(a, b)

/** 헤더 클릭 순환: 다른 컬럼 → asc, asc → desc, desc → 기본 정렬 */
export function nextSort(current: SortState, key: string, defaultSort: SortState): SortState {
  if (current.key !== key) return { key, dir: 'asc' }
  if (current.dir === 'asc') return { key, dir: 'desc' }
  return defaultSort
}

export function sortRows<T>(
  rows: T[],
  columns: ColumnDef<T>[],
  sort: SortState,
  tieBreak: (a: T, b: T) => number,
): T[] {
  const col = columns.find((c) => c.key === sort.key)
  if (!col) return [...rows]
  const sign = sort.dir === 'asc' ? 1 : -1
  const blank = (r: T) => col.sortValue == null && !(col.accessor(r) ?? '').trim()
  return [...rows].sort((a, b) => {
    const ab = blank(a)
    const bb = blank(b)
    if (ab !== bb) return ab ? 1 : -1 // 빈 값은 방향과 무관하게 항상 뒤
    if (!ab) {
      let c = 0
      if (col.sortValue) c = col.sortValue(a) - col.sortValue(b)
      else if (col.type === 'date') c = (Date.parse(col.accessor(a) ?? '') || 0) - (Date.parse(col.accessor(b) ?? '') || 0)
      else c = compareText(col.accessor(a) ?? '', col.accessor(b) ?? '')
      if (c !== 0) return c * sign
    }
    return tieBreak(a, b)
  })
}

function localDateKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function filterRows<T>(rows: T[], columns: ColumnDef<T>[], filters: Filters): T[] {
  return rows.filter((row) =>
    columns.every((col) => {
      const v = col.accessor(row) ?? ''
      if (col.type === 'date') {
        const from = filters[`${col.key}.from`] ?? ''
        const to = filters[`${col.key}.to`] ?? ''
        if (!from && !to) return true
        const k = localDateKey(v)
        if (!k) return false
        return !(from && k < from) && !(to && k > to)
      }
      const q = (filters[col.key] ?? '').trim()
      if (!q) return true
      if (col.type === 'select') return v === q
      return v.toLowerCase().includes(q.toLowerCase())
    }),
  )
}

export function hasActiveFilters(filters: Filters): boolean {
  return Object.values(filters).some((v) => v.trim() !== '')
}

// ── 보기 상태(정렬+필터) localStorage 저장 ──
export interface ViewState {
  sort: SortState
  filters: Filters
}

export function loadView<T>(
  storageKey: string,
  columns: ColumnDef<T>[],
  defaultSort: SortState,
): ViewState {
  try {
    const p = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (p) {
      const sortOk =
        columns.some((c) => c.key === p.sort?.key) && (p.sort.dir === 'asc' || p.sort.dir === 'desc')
      const filters: Filters = {}
      if (p.filters && typeof p.filters === 'object') {
        for (const [k, v] of Object.entries(p.filters)) {
          if (typeof v !== 'string') continue
          const col = columns.find((c) => c.key === k)
          // 저장된 select 값이 더 이상 없는 선택지면 버린다(빈 결과 방지)
          if (col?.type === 'select' && !col.options?.some((o) => o.value === v)) continue
          filters[k] = v
        }
      }
      return { sort: sortOk ? { key: p.sort.key, dir: p.sort.dir } : defaultSort, filters }
    }
  } catch {
    /* 저장소 접근/파싱 실패 → 기본값 */
  }
  return { sort: defaultSort, filters: {} }
}

export function saveView(storageKey: string, view: ViewState): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(view))
  } catch {
    /* ignore */
  }
}

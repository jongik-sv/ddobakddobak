export type ViewMode = 'card' | 'list'
export type SortField = 'created_at' | 'title'
export type SortDirection = 'asc' | 'desc'

export const VIEW_MODE_KEY = 'meetings-view-mode'

export function getStoredViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_MODE_KEY)
  return stored === 'list' ? 'list' : 'card'
}

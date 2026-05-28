import type { FolderNode } from '../api/folders'

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function folderName(folders: FolderNode[], id: number): string | null {
  for (const f of folders) {
    if (f.id === id) return f.name
    const found = folderName(f.children, id)
    if (found) return found
  }
  return null
}

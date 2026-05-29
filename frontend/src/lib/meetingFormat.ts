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

export function folderPath(folders: FolderNode[], id: number, sep = ' / '): string | null {
  const walk = (nodes: FolderNode[], trail: string[]): string[] | null => {
    for (const f of nodes) {
      const next = [...trail, f.name]
      if (f.id === id) return next
      const found = walk(f.children, next)
      if (found) return found
    }
    return null
  }
  return walk(folders, [])?.join(sep) ?? null
}

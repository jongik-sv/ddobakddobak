import type { FolderNode } from '../api/folders'
import type { Meeting } from '../api/meetings'

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const

/** 예약 시작 시각을 'YYYY.MM.DD HH:mm'(24h, 로컬)로 포맷. UTC 슬라이스 금지, 로컬 getter만 사용. */
export function formatScheduledStart(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const mo = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const mi = pad(d.getMinutes())
  return `${y}.${mo}.${day} ${h}:${mi}`
}

/** 예약 회의의 자동/수동 + 반복 요약 라벨. 예: '자동 · 매주 월, 수' / '수동' / '자동 · 매일'. */
export function scheduleSummary(
  meeting: Pick<Meeting, 'auto_start_mode' | 'recurrence_rule'>,
): string {
  const mode = meeting.auto_start_mode === 'auto' ? '자동' : '수동'
  const rule = meeting.recurrence_rule
  if (!rule) return mode
  if (rule.freq === 'weekly' && rule.days && rule.days.length > 0) {
    const labels = [...rule.days]
      .filter((d) => d >= 0 && d <= 6)
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d])
    if (labels.length > 0) return `${mode} · 매주 ${labels.join(', ')}`
  }
  if (rule.freq === 'daily') return `${mode} · 매일`
  return mode
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', // 24시간제 — 오전/오후 제거(레이아웃 줄바꿈 방지)
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

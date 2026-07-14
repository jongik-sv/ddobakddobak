import { ChevronRight, FolderClosed } from 'lucide-react'

interface Props {
  projectName?: string | null
  folderPath?: { id: number; name: string }[]
  className?: string
}

/** 회의 상세·라이브 상단에 '프로젝트 › 폴더 › 하위폴더' 위치 경로를 표시(비대화형). */
export function MeetingPathBreadcrumb({ projectName, folderPath, className = '' }: Props) {
  const folders = folderPath ?? []
  const hasProject = !!projectName
  if (!hasProject && folders.length === 0) return null

  const segments: string[] = []
  if (hasProject) segments.push(projectName as string)
  if (folders.length > 0) folders.forEach((f) => segments.push(f.name))
  else if (hasProject) segments.push('미분류')

  return (
    <nav aria-label="회의 위치" className={`flex items-center gap-1 text-xs text-muted-foreground min-w-0 ${className}`}>
      <FolderClosed className="w-3 h-3 shrink-0" />
      {segments.map((name, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          {i > 0 && <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />}
          <span className={`truncate ${i === segments.length - 1 ? 'text-foreground font-medium' : ''}`}>{name}</span>
        </span>
      ))}
    </nav>
  )
}

import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { useProjectStore } from '../../stores/projectStore'
import type { Project } from '../../api/projects'
import ProjectIcon from './ProjectIcon'
import IconPicker, { type IconValue } from './IconPicker'

interface ProjectDialogProps {
  project?: Project
  onClose: () => void
  onSaved?: (project: Project) => void
}

export default function ProjectDialog({ project, onClose, onSaved }: ProjectDialogProps) {
  const createProject = useProjectStore((s) => s.createProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [icon, setIcon] = useState<IconValue>({
    icon_type: project?.icon_type ?? null,
    icon_value: project?.icon_value ?? null,
    color: project?.color ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const preview: Project = {
    id: project?.id ?? 0,
    name: name || '프로젝트',
    description: null,
    icon_type: icon.icon_type,
    icon_value: icon.icon_value,
    color: icon.color,
    personal: project?.personal ?? false,
    role: project?.role ?? 'admin',
    member_count: project?.member_count ?? 1,
    meeting_count: project?.meeting_count ?? 0,
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        icon_type: icon.icon_type,
        icon_value: icon.icon_value,
        color: icon.color,
      }
      if (project) {
        await updateProject(project.id, payload)
        onSaved?.({ ...project, ...payload })
      } else {
        const created = await createProject(payload)
        onSaved?.(created)
      }
      onClose()
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      onClose={onClose}
      backdropClassName="bg-black/20 backdrop-blur-sm"
      className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto"
    >
      <h2 className="mb-4 text-lg font-semibold">{project ? '프로젝트 편집' : '새 프로젝트'}</h2>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-3">
          <ProjectIcon project={preview} size={48} />
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="프로젝트 이름"
              maxLength={100}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">설명 (선택)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="프로젝트 설명"
            rows={2}
            className="w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">아이콘</label>
          <IconPicker value={icon} onChange={setIcon} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {project ? '저장' : '생성'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

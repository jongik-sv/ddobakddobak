import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { exportProject } from '../../api/projectTransfers'
import type { Project } from '../../api/projects'
import { projectDisplayName } from '../../api/projects'

interface ExportProjectDialogProps {
  project: Project
  onClose: () => void
}

/**
 * 프로젝트 내보내기 모달(시스템 admin 전용). "음성 포함" 체크박스 + 확인 →
 * exportProject 로 .ddobak.tgz 다운로드. 회의가 많고 음성을 포함하면 시간이 걸릴 수 있어
 * 진행 중 표시를 둔다.
 */
export default function ExportProjectDialog({ project, onClose }: ExportProjectDialogProps) {
  const [includeAudio, setIncludeAudio] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try {
      await exportProject(project.id, {
        includeAudio,
        fallbackName: projectDisplayName(project),
      })
      onClose()
    } catch {
      setError('내보내기에 실패했습니다.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog
      onClose={onClose}
      backdropClassName="bg-black/20 backdrop-blur-sm"
      className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
      ariaLabel="프로젝트 내보내기"
    >
      <h2 className="mb-1 text-lg font-semibold text-foreground">프로젝트 내보내기</h2>
      <p className="mb-4 truncate text-sm text-muted-foreground">{projectDisplayName(project)}</p>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
        <input
          type="checkbox"
          checked={includeAudio}
          onChange={(e) => setIncludeAudio(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-indigo-600"
          disabled={exporting}
        />
        <span>
          <span className="font-medium text-foreground">음성 포함</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            끄면 회의록·요약 등 메타데이터만 내보냅니다(파일 크기 작음).
          </span>
        </span>
      </label>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={exporting}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {exporting ? '내보내는 중…' : '내보내기'}
        </button>
      </div>
    </Dialog>
  )
}

import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { importMeeting, importFolder } from '../../api/transfers'

interface ImportResult {
  type: 'meeting' | 'folder'
  meeting_id?: number
  folder_id?: number
  meeting_ids?: number[]
}

interface ImportTransferButtonProps {
  /** 가져올 대상 프로젝트 id. */
  projectId: number
  /** 현재 선택된 폴더 id(회의 import → folder_id, 폴더 import → parent_folder_id). */
  folderId?: number
  /** 가져오기 성공 시 결과와 함께 호출(목록 refetch 등). */
  onImported: (result: ImportResult) => void
}

/**
 * 회의·폴더 가져오기 버튼.
 * 파일명이 `.ddobak-folder.tgz` 를 포함하면 폴더 import, 그 외는 회의 import.
 * props: projectId(필수), folderId?(현재 폴더), onImported(결과 콜백).
 */
export default function ImportTransferButton({
  projectId,
  folderId,
  onImported,
}: ImportTransferButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  const handlePick = () => {
    setError('')
    inputRef.current?.click()
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 같은 파일 재선택 시에도 onChange 발화하도록 값 초기화
    e.target.value = ''
    if (!file) return

    setImporting(true)
    setError('')
    try {
      if (file.name.includes('.ddobak-folder.tgz')) {
        // 폴더 import: 현재 폴더를 parent_folder_id 로 전달
        const result = await importFolder(projectId, file, folderId)
        onImported({ type: 'folder', folder_id: result.folder_id, meeting_ids: result.meeting_ids })
      } else {
        // 회의 import(.ddobak-meeting.tgz 또는 기타): 현재 폴더를 folder_id 로 전달
        const result = await importMeeting(projectId, file, folderId)
        onImported({ type: 'meeting', meeting_id: result.meeting_id })
      }
    } catch {
      setError('가져오기에 실패했습니다. 올바른 내보내기 파일인지 확인해 주세요.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handlePick}
        disabled={importing}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
      >
        {importing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {importing ? '가져오는 중…' : '가져오기(.tgz)'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".tgz,.gz"
        onChange={handleFile}
        className="hidden"
      />
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  )
}

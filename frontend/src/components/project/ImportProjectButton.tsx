import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { importProject } from '../../api/projectTransfers'

interface ImportProjectButtonProps {
  /**
   * 가져오기 성공 시 새 project_id 와 함께 호출(목록 갱신 + 이동 등).
   * 부분 실패 경고가 있으면 두 번째 인자로 함께 전달한다(ImportTransferButton 과 동일하게
   * 호출자도 경고를 이어받을 수 있도록).
   */
  onImported: (projectId: number, warnings?: string[]) => void
}

/**
 * 프로젝트 가져오기 버튼(시스템 admin 전용). 숨겨진 file input 으로 .ddobak/.tgz/.gz 를 선택해
 * 업로드하고, 완료 시 onImported(project_id, warnings) 를 호출한다. 업로드 동안 스피너로 진행 표시.
 * 응답의 warnings(화자 로스터 복원 실패·public_uid 충돌 등)는 ImportTransferButton 과 같은
 * 방식으로 버튼 아래 amber 경고 문구로 노출한다.
 */
export default function ImportProjectButton({ onImported }: ImportProjectButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')

  const handlePick = () => {
    setError('')
    setWarning('')
    inputRef.current?.click()
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 같은 파일 재선택 시에도 onChange 가 발화하도록 값 초기화
    e.target.value = ''
    if (!file) return

    setImporting(true)
    setError('')
    setWarning('')
    try {
      const result = await importProject(file)
      if (result.warnings?.length) setWarning(result.warnings.join(' '))
      onImported(result.project_id, result.warnings)
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
        {importing ? '가져오는 중…' : '가져오기'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".ddobak,.tgz,.gz,application/gzip"
        onChange={handleFile}
        className="hidden"
      />
      {warning && (
        <span role="alert" className="text-xs text-amber-600">
          {warning}
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  )
}

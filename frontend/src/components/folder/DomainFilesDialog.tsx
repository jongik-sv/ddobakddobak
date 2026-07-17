import { Dialog } from '../ui/Dialog'
import DomainFilesPanel from '../meeting/DomainFilesPanel'

interface DomainFilesDialogProps {
  folderId: number
  folderName: string
  /** 폴더가 속한 프로젝트 — 신규 작성·업로드 스코프 및 선택 가능 목록 범위에 사용 */
  projectId: number | null
  onClose: () => void
}

/** 폴더 단위 도메인 파일(용어집) 관리 다이얼로그 — 오타 사전(GlossaryDialog)과 같은 컨텍스트 메뉴 경로에서 연다. */
export default function DomainFilesDialog({ folderId, folderName, projectId, onClose }: DomainFilesDialogProps) {
  return (
    <Dialog
      onClose={onClose}
      backdropClassName="bg-black/10 backdrop-blur-sm"
      className="w-full max-w-lg rounded-xl bg-card p-6 shadow-2xl border border-border max-h-[90vh] overflow-y-auto"
    >
      <h2 className="text-lg font-semibold mb-1">도메인 파일 — {folderName}</h2>
      <p className="text-xs text-muted-foreground mb-4">
        이 폴더에 연결된 도메인 파일은 하위 모든 회의에 자동 적용됩니다(상속).
      </p>

      <DomainFilesPanel ownerType="folder" ownerId={folderId} projectId={projectId} canEdit={true} collapsible={false} />

      <div className="flex justify-end mt-4">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
          닫기
        </button>
      </div>
    </Dialog>
  )
}

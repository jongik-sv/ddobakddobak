import { Dialog } from '../ui/Dialog'
import CollaboratorsPanel from '../meeting/CollaboratorsPanel'

interface FolderCollaboratorsDialogProps {
  folderId: number
  folderName: string
  /** 협업자 추가 대상(프로젝트 멤버) 조회 범위 */
  projectId: number | null
  onClose: () => void
}

/**
 * 폴더 단위 협업자 관리 다이얼로그 — idea 44. DomainFilesDialog와 동형(같은 컨텍스트 메뉴 경로).
 * canManage은 항상 true로 고정 — 서버가 authorize_folder_edit!로 걸러주며, FolderTree.tsx는
 * 다른 메뉴 항목(이름변경·휴지통 등)과 마찬가지로 클라이언트 사전 필터링을 하지 않는다(서버 403이 최종 방어선).
 */
export default function FolderCollaboratorsDialog({ folderId, folderName, projectId, onClose }: FolderCollaboratorsDialogProps) {
  return (
    <Dialog
      onClose={onClose}
      backdropClassName="bg-black/10 backdrop-blur-sm"
      className="w-full max-w-lg rounded-xl bg-card p-6 shadow-2xl border border-border max-h-[90vh] overflow-y-auto"
    >
      <h2 className="text-lg font-semibold mb-1">협업자 관리 — {folderName}</h2>
      <p className="text-xs text-muted-foreground mb-4">
        이 폴더의 협업자는 하위 모든 회의에 실시간 상속됩니다.
      </p>

      <CollaboratorsPanel ownerType="folder" ownerId={folderId} projectId={projectId} canManage={true} />

      <div className="flex justify-end mt-4">
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
          닫기
        </button>
      </div>
    </Dialog>
  )
}

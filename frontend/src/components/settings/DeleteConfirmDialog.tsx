import { useState } from 'react'
import type { AdminUser } from '../../api/adminUsers'

/** 사용자 삭제 확인 다이얼로그 */
export function DeleteConfirmDialog({
  user,
  onClose,
  onConfirm,
}: {
  user: AdminUser
  onClose: () => void
  onConfirm: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    await onConfirm()
    setDeleting(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-card shadow-2xl border border-border p-6 mx-4">
        <h3 className="text-lg font-semibold mb-2">사용자 삭제</h3>
        <p className="text-sm text-muted-foreground mb-1">
          <strong>{user.name}</strong> ({user.email})
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          이 사용자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-accent transition-colors min-h-[44px]"
          >
            취소
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}

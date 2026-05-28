import { Dialog } from './Dialog'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  /** 확인 버튼 색상 클래스 (기본: amber) */
  confirmClassName?: string
}

const DEFAULT_CONFIRM_CLASS = 'px-3 py-1.5 text-sm rounded-md bg-amber-500 text-white hover:bg-amber-600'

/** 제목 + 안내문 + 취소/확인 버튼의 단순 확인 모달. 백드롭/Esc로는 닫히지 않는다. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, confirmClassName }: ConfirmDialogProps) {
  return (
    <Dialog
      onClose={onCancel}
      closeOnBackdrop={false}
      closeOnEsc={false}
      className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full mx-4"
    >
      <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-600 mb-4">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          취소
        </button>
        <button
          onClick={onConfirm}
          className={confirmClassName ?? DEFAULT_CONFIRM_CLASS}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}

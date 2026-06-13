import { Dialog } from '../ui/Dialog'

interface StopMeetingDialogProps {
  onSummarize: () => void
  onSkip: () => void
  onCancel: () => void
}

/** 회의 종료 시 최종 AI 요약 여부 확인. [요약하고 종료] / [요약 없이 종료] / [취소]. */
export function StopMeetingDialog({ onSummarize, onSkip, onCancel }: StopMeetingDialogProps) {
  return (
    <Dialog
      onClose={onCancel}
      closeOnBackdrop={false}
      closeOnEsc={false}
      className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full mx-4"
    >
      <h3 className="text-base font-semibold text-gray-900 mb-2">회의 종료</h3>
      <p className="text-sm text-gray-600 mb-4">이번 회의를 AI로 최종 요약할까요?</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          취소
        </button>
        <button
          onClick={onSkip}
          className="px-3 py-1.5 text-sm rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300"
        >
          요약 없이 종료
        </button>
        <button
          onClick={onSummarize}
          className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          요약하고 종료
        </button>
      </div>
    </Dialog>
  )
}

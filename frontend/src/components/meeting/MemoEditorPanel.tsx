import { MeetingEditor } from '../editor/MeetingEditor'
import { DecisionList } from '../decision/DecisionList'
import type { useMemoEditor } from '../../hooks/useMemoEditor'

type MemoEditorRef = ReturnType<typeof useMemoEditor>['memoEditorRef']
type OnEditorReady = ReturnType<typeof useMemoEditor>['onEditorReady']

/** 메모 에디터 + Decision Log 패널 — 데스크톱 패널/모바일 탭 양쪽에서 재사용 */
export function MemoEditorPanel({
  meetingId,
  editorRef,
  onEditorReady,
  onSave,
  isSaving,
  readOnly = false,
}: {
  meetingId: number
  editorRef: MemoEditorRef
  onEditorReady?: OnEditorReady
  onSave: () => void
  isSaving: boolean
  /** 잠긴 회의면 메모 편집·저장과 결정사항 편집을 막는다 (읽기 전용). 기본 false. */
  readOnly?: boolean
}) {
  return (
    <section data-testid="memo-editor" className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted shrink-0">
        <h2 className="text-sm font-semibold text-gray-500">메모</h2>
        {!readOnly && (
          <button
            onClick={onSave}
            disabled={isSaving}
            className="px-3 py-1 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? '저장 중...' : '저장'}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <MeetingEditor editorRef={editorRef} onReady={onEditorReady} editable={!readOnly} />
      </div>
      <div className="border-t shrink-0 overflow-y-auto max-h-[40%]">
        <DecisionList meetingId={meetingId} readOnly={readOnly} />
      </div>
    </section>
  )
}

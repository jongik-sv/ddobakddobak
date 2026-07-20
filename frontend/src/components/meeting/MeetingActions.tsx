import { Bot, Play, RefreshCw, Trash2, Users } from 'lucide-react'
import type { Meeting } from '../../api/meetings'
import { Tooltip } from '../ui/Tooltip'
import { ExportButton } from './ExportButton'
import { ACTION_NEUTRAL, ACTION_AMBER, ACTION_BLUE, ACTION_DANGER } from './actionButtonStyles'

interface MeetingActionsProps {
  meeting: Meeting
  meetingId: number
  isDesktop: boolean
  transcriptsCount: number
  isRegeneratingNotes: boolean
  onShowSttConfirm: () => void
  onShowReDiarizeConfirm: () => void
  onShowNotesConfirm: () => void
  onReopen: () => void
  onGoLive: () => void
  onDelete: () => void
  /** 소유자/admin만 제어 어포던스 노출 (기본 true). */
  canEdit?: boolean
  /** D'Flow 전송/연결 mutation 성공 시 호출(ExportButton 경유 SendToDflowDialog로 전달) — 상위가
   *  meeting을 refetch해 배지·상태 텍스트를 최신화하도록 한다. */
  onChanged?: () => void
}

/**
 * 회의 상세 액션 버튼 묶음(STT/회의록 재생성·회의 진행/재개·내보내기·삭제).
 * 상단 툴바(MeetingDetailTopBar) 우측에 배치 → 제목 줄을 차지하지 않아 모바일에서 제목이
 * "..."으로 잘리지 않는다. ml-auto로 우측 정렬.
 */
export function MeetingActions({
  meeting,
  meetingId,
  isDesktop,
  transcriptsCount,
  isRegeneratingNotes,
  onShowSttConfirm,
  onShowReDiarizeConfirm,
  onShowNotesConfirm,
  onReopen,
  onGoLive,
  onDelete,
  canEdit = true,
  onChanged,
}: MeetingActionsProps) {
  // 잠긴 회의: 내용을 바꾸는 모든 어포던스를 비활성(disabled + 안내 툴팁). 내보내기(읽기)는 예외.
  const locked = meeting.locked
  const lockTitle = '잠긴 회의입니다 — 잠금을 해제한 뒤 다시 시도하세요.'
  return (
    <>
    <div className={`flex items-center shrink-0 ml-auto ${isDesktop ? 'gap-2' : 'gap-1'}`}>
      {/* STT 재생성: 오디오만 있으면 가능 — 전사 실패로 pending+트랜스크립트 0건이 된 회의의 복구 경로 */}
      {canEdit && meeting.has_audio_file && (meeting.status === 'completed' || meeting.status === 'pending') && (
        <Tooltip text={locked ? lockTitle : 'STT 재생성'}>
          <button
            onClick={onShowSttConfirm}
            disabled={locked}
            aria-label="STT 재생성"
            className={ACTION_NEUTRAL}
          >
            <RefreshCw className="w-4 h-4" />
            {isDesktop && 'STT 재생성'}
          </button>
        </Tooltip>
      )}
      {/* 화자분리만 재실행: 전사는 유지하고 현재 민감도로 화자만 재분리(다시 전사 안 함, ~1~2분) */}
      {canEdit && meeting.has_audio_file && meeting.status === 'completed' && (
        <Tooltip
          position="left"
          text={locked ? lockTitle : '다시 전사하지 않고, 현재 민감도 설정으로 화자만 다시 분리합니다 (약 1~2분). 전사 텍스트는 유지되고 화자 이름만 초기화됩니다.'}
        >
          <button
            onClick={onShowReDiarizeConfirm}
            disabled={locked}
            aria-label="화자분리만 재실행"
            className={ACTION_NEUTRAL}
          >
            <Users className="w-4 h-4" />
            {isDesktop && '화자분리만 재실행'}
          </button>
        </Tooltip>
      )}
      {canEdit && meeting.status === 'completed' && (
        <>
          {transcriptsCount > 0 && (
            <Tooltip text={locked ? lockTitle : 'AI 회의록 재생성'}>
              <button
                onClick={onShowNotesConfirm}
                disabled={isRegeneratingNotes || locked}
                aria-label="회의록 재생성"
                className={ACTION_NEUTRAL}
              >
                {isRegeneratingNotes ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {isDesktop && '재생성 중...'}
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4" />
                    {isDesktop && '회의록 재생성'}
                  </>
                )}
              </button>
            </Tooltip>
          )}
          <Tooltip text={locked ? lockTitle : '회의 재개'}>
            <button
              onClick={onReopen}
              disabled={locked}
              aria-label="회의 재개"
              className={ACTION_AMBER}
            >
              <Play className="w-4 h-4" />
              {isDesktop && '회의 재개'}
            </button>
          </Tooltip>
        </>
      )}
      {canEdit && (meeting.status === 'pending' || meeting.status === 'recording') && (
        <Tooltip text={locked ? lockTitle : '회의 진행'}>
          <button
            onClick={onGoLive}
            disabled={locked}
            aria-label="회의 진행"
            className={ACTION_BLUE}
          >
            <Play className="w-4 h-4" />
            {isDesktop && '회의 진행'}
          </button>
        </Tooltip>
      )}
      <ExportButton
        meetingId={meetingId}
        meetingTitle={meeting.title}
        meetingDate={meeting.started_at ?? meeting.created_at}
        meeting={meeting}
        onChanged={onChanged}
      />
      {canEdit && (
        <Tooltip text={locked ? lockTitle : '삭제'}>
          <button
            onClick={onDelete}
            disabled={locked}
            aria-label="삭제"
            className={ACTION_DANGER}
          >
            <Trash2 className="w-4 h-4" />
            {isDesktop && '삭제'}
          </button>
        </Tooltip>
      )}
    </div>
    </>
  )
}

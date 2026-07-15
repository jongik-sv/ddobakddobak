export interface MeetingDetail {
  id: number
  title: string
  status: 'pending' | 'recording' | 'transcribing' | 'completed'
  started_at: string | null
  ended_at: string | null
  created_by_id: number
  /** 모든 사용자에게 공유 여부 (기본 true) */
  shared: boolean
  /** 회의 잠금 여부. 잠금되면 편집이 차단된다(소유자/admin만 잠금/해제). */
  locked: boolean
  /** 잠금 시각 (ISO 문자열). 미잠금이면 null. */
  locked_at: string | null
  /** 중요 표시 여부. */
  important: boolean
  created_at: string
  updated_at: string
}

export type MeetingAccessError = 'forbidden' | 'not_found' | 'unknown'

export interface MeetingAccessResult {
  meeting: MeetingDetail | null
  error: MeetingAccessError | null
}

export interface Meeting {
  id: number
  title: string
  status: 'pending' | 'recording' | 'transcribing' | 'completed'
  meeting_type: string
  created_by: { id: number; name: string }
  brief_summary: string | null
  source?: 'live' | 'upload'
  has_audio_file?: boolean
  /** 이 회의가 속한 프로젝트 id (프로젝트 스코핑). */
  project_id?: number | null
  folder_id: number | null
  /** 회의가 속한 프로젝트 이름 (show=full 응답에만 포함). 상세·라이브 경로 표시용. */
  project_name?: string | null
  /** 폴더 루트→현재 경로 [{id,name}]. 폴더 없으면 빈 배열. show=full 응답에만 포함. */
  folder_path?: { id: number; name: string }[]
  /** 이 회의가 속한 폴더의 공유 여부(상세 응답에만 포함). false면 폴더가 비공개라 회의도 숨겨진다. */
  folder_shared?: boolean | null
  transcription_progress?: number
  audio_duration_ms: number
  last_transcript_end_ms: number
  last_sequence_number: number
  memo: string | null
  attendees: string | null
  /** 참여 인원수 (화자분리 ±2 힌트). null=자동 감지 */
  expected_participants?: number | null
  tags?: { id: number; name: string; color: string }[]
  share_code?: string | null
  /** 모든 사용자에게 공유 여부 (기본 true). 비공유면 소유자/admin만 조회 가능. */
  shared: boolean
  /** 회의 잠금 여부. 잠금되면 편집이 차단된다(소유자/admin만 잠금/해제). */
  locked: boolean
  /** 잠금 시각 (ISO 문자열). 미잠금이면 null. */
  locked_at: string | null
  /** 중요 표시 여부. 기본 목록은 important=true만 노출(show_all로 해제). */
  important: boolean
  /** 현재 사용자가 이 회의를 수정/삭제할 수 있는지 (소유자 ∨ admin). 서버가 계산해 내려준다. */
  editable?: boolean
  started_at: string | null
  ended_at: string | null
  created_at: string
  /** 회의록 압축율 5단계 (very_concise|concise|standard|detailed|very_detailed) */
  summary_verbosity?: SummaryVerbosity
  /** true=지속 재구조화(매 틱 전체 재정리), false=증분(앞 내용 불변, 시간대별 추가) */
  summary_restructure?: boolean
  /** 최근 최종(final) 요약 실패 사유. 성공 저장 시 서버가 null로 클리어. */
  summary_error_message?: string | null
  /** 최근 최종 요약 실패 시각 (ISO 문자열). */
  summary_error_at?: string | null
  /** 이전 회의 참고: 이 회의록의 시작점(시드)이 된 회의 id (상세 응답에만 포함) */
  previous_meeting_id?: number | null
  /** 이전 회의 참고 배지 표시용 제목 (상세 응답에만 포함) */
  previous_meeting_title?: string | null
  /** 배치 재전사에 실제 사용된 STT 엔진(실시간 녹음은 null). 회의 정보 표시용 */
  stt_engine?: string | null
  /** 예약 시작 시각 (ISO 문자열, UTC). null=즉시 회의(기존 동작). */
  scheduled_start_time?: string | null
  /** 예약 회의 시작 방식. auto=묻지 않고 자동 시작, manual=1분 전 확인 프롬프트. */
  auto_start_mode?: 'auto' | 'manual' | null
  /** 반복 예약 규칙. null=1회성. */
  recurrence_rule?: RecurrenceRule | null
  /** 사용자가 놓친 예약 안내를 닫은 시각 (목록에서 숨김). */
  schedule_dismissed_at?: string | null
}

/** 반복 예약 규칙. days: 0=일~6=토 (weekly에서만 사용). time: "HH:MM". tz: IANA 타임존. */
export interface RecurrenceRule {
  freq: 'weekly' | 'daily'
  days?: number[]
  time: string
  tz: string
}

/** GET meetings/scheduled 응답 항목: 예약 회의 + 놓침 여부 플래그. */
export type ScheduledMeeting = Meeting & { missed: boolean }

export type SummaryVerbosity = 'very_concise' | 'concise' | 'standard' | 'detailed' | 'very_detailed'

export interface MeetingListMeta {
  total: number
  page: number
  per: number
  status_counts?: Partial<Record<Meeting['status'], number>>
}

export interface MeetingListResponse {
  meetings: Meeting[]
  meta: MeetingListMeta
}

export interface GetMeetingsParams {
  page?: number
  per?: number
  q?: string
  status?: string
  date_from?: string
  date_to?: string
  folder_id?: number | null
  /** 프로젝트 스코핑. 지정 시 해당 프로젝트의 회의만 조회한다. */
  project_id?: number | null
  /** true면 중요 필터를 해제하고 전체 회의를 가져온다(show_all=1). 미지정/false면 important=true만. */
  show_all?: boolean
}

/** 온디바이스(로컬) STT 결과를 서버에 일괄 영속화한다 (멱등: sequence_number 기준 upsert). */
export interface BulkTranscriptItem {
  content: string
  speaker_label: string
  started_at_ms: number
  ended_at_ms: number
  sequence_number: number
  audio_source?: 'mic' | 'system'
}

export interface SummaryResponse {
  id: number
  meeting_id: number
  key_points: string[]
  decisions: string[]
  discussion_details: string[]
  notes_markdown?: string
  summary_type: 'realtime' | 'final'
  generated_at: string
}

export interface UpdateMeetingParams {
  title?: string
  folder_id?: number | null
  meeting_type?: string
  tag_ids?: number[]
  brief_summary?: string | null
  attendees?: string | null
  expected_participants?: number | null
  /** 공유 여부. 소유자/admin만 반영된다(서버 강제). */
  shared?: boolean
  /** 중요 표시 여부. */
  important?: boolean
  summary_verbosity?: SummaryVerbosity
  summary_restructure?: boolean
  /** 이전 회의 참고. null/빈값이면 해제 */
  previous_meeting_id?: number | null
  /** 예약 시작 시각 (ISO UTC). null=예약 해제. pending 회의 수정에서만 의미 있음. */
  scheduled_start_time?: string | null
  /** 예약 시작 방식. null=예약 해제. */
  auto_start_mode?: 'auto' | 'manual' | null
  /** 반복 예약 규칙. null=1회성/해제. */
  recurrence_rule?: RecurrenceRule | null
}

export interface TermCorrection {
  from: string
  to: string
}

export interface Transcript {
  id: number
  speaker_label: string
  speaker_name?: string | null
  content: string
  started_at_ms: number
  ended_at_ms: number
  sequence_number: number
  applied_to_minutes?: boolean
}

export interface ExportOptions {
  include_summary: boolean
  include_memo: boolean
  include_transcript: boolean
}

export interface MeetingExportData {
  meeting: {
    id: number
    title: string
    date: string
    start_time: string
    end_time: string
    status: string
    creator_name: string
  }
  summary: {
    type: 'notes_markdown' | 'json_fields'
    notes_markdown?: string
    key_points?: string[]
    decisions?: string[]
    discussion_details?: string[]
  } | null
  memo?: string | null
  action_items: Array<{
    content: string
    status: string
    assignee_name: string | null
    due_date: string | null
  }>
  transcripts: Array<{
    speaker_label: string
    speaker_name?: string | null
    timestamp: string
    content: string
  }>
}

// --- 공유 API ---

export interface Participant {
  id: number
  user_id: number
  user_name: string
  role: 'host' | 'viewer'
  joined_at: string
}

export interface ShareResponse {
  share_code: string
  participants: Participant[]
}

export interface JoinResponse {
  meeting: Meeting
  participant: Participant
}

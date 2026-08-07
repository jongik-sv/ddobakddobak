module MeetingSerializable
  extend ActiveSupport::Concern

  private

  def meeting_json(meeting, full: false)
    attachment_counts = meeting.meeting_attachments.loaded? ?
      meeting.meeting_attachments.group_by(&:category).transform_values(&:size) :
      meeting.meeting_attachments.group(:category).count

    json = {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status,
      meeting_type: meeting.meeting_type,
      started_at: meeting.started_at,
      ended_at: meeting.ended_at,
      paused_at: meeting.paused_at,
      # 단일 녹음 기기 락: 점유 기기 id + 활성 점유 여부(프론트가 "내 기기인가/충돌인가" 판단).
      recording_client_id: meeting.recording_client_id,
      recorder_active: meeting.recorder_active?,
      created_by_id: meeting.created_by_id,
      created_by: { id: meeting.created_by_id, name: meeting.creator&.name },
      shared: meeting.shared,
      locked: meeting.locked?,
      locked_at: meeting.locked_at,
      important: meeting.important,
      editable: meeting.editable_by?(current_user),
      brief_summary: meeting.brief_summary,
      source: meeting.source,
      transcription_progress: meeting.transcription_progress,
      # 파일 전사 대기열 위치 — status=transcribing이고 아직 대기 중일 때만 값, 그 외 nil.
      # 큐 잡 스냅샷은 요청(컨트롤러 인스턴스) 단위로 1회만 조회해 재사용한다 — index에서
      # transcribing 회의가 여러 건이면 meeting_json 호출마다 큐 DB를 재조회하던 N+1을 없앤다.
      transcription_queue_position: meeting.transcribing? ? meeting.transcription_queue_position(transcription_queue_jobs_snapshot) : nil,
      has_audio_file: meeting.audio_file_path.present?,
      folder_id: meeting.folder_id,
      project_id: meeting.project_id,
      memo: meeting.memo,
      attendees: meeting.attendees,
      expected_participants: meeting.expected_participants,
      summary_verbosity: meeting.summary_verbosity,
      summary_restructure: meeting.summary_restructure,
      summary_custom_prompt: meeting.summary_custom_prompt,
      summary_interval_sec: meeting.summary_interval_sec,
      # 최근 final 요약 실패 사유/시각 (성공 저장 시 클리어) — 새로고침 후에도 실패를 레포트.
      summary_error_message: meeting.summary_error_message,
      summary_error_at: meeting.summary_error_at,
      # 요약(regenerate/summarize/final/realtime) 진행 중 영속 상태 — 회의목록 StatusBadge 와
      # 상세 배지가 페이지 이탈·새로고침 후에도 "요약중"을 표시. 목록(full:false)에도 노출.
      summarizing: meeting.summarizing?,
      summarization_started_at: meeting.summarization_started_at&.iso8601,
      stt_engine: meeting.stt_engine,
      scheduled_start_time: meeting.scheduled_start_time,
      auto_start_mode: meeting.auto_start_mode,
      recurrence_rule: parse_recurrence_rule(meeting.recurrence_rule),
      schedule_dismissed_at: meeting.schedule_dismissed_at,
      tags: meeting.tags.map { |t| { id: t.id, name: t.name, color: t.color } },
      attachment_counts: {
        agenda: attachment_counts["agenda"] || 0,
        reference: attachment_counts["reference"] || 0,
        minutes: attachment_counts["minutes"] || 0
      },
      created_at: meeting.created_at,
      updated_at: meeting.updated_at,
      # D'Flow 전송 상태(목록 카드 배지·필터용) — 상세 재조회 없이 목록에서도 배지를 그릴 수 있어야
      # 해서 summarizing 과 같은 이유로 목록(full:false)에도 노출한다. public_uid·dflow_url 은
      # 카드가 링크를 걸지 않으므로 full 블록에만 남긴다(아래).
      dflow_synced_at: meeting.dflow_synced_at,
      dflow_needs_resync: meeting.dflow_needs_resync?,
      # 기밀 구간 절단(transcripts#redact) 표식. 이 회의는 추가 녹음·전사 동기화를 받지 않는다
      # (bulk_create·오디오 create/chunk/finalize 가 409 + code=meeting_redacted).
      # summarizing 과 같은 이유로 목록(full:false)에도 노출한다 — 회의 카드가 상세 재조회 없이
      # 배지를 그려야 하고, 프론트가 녹음 버튼을 비활성화할 판단 근거도 목록에서 필요하다.
      # 불리언을 함께 주는 이유: 클라이언트가 nil 비교 대신 그대로 쓰게(문자열 truthy 함정 방지).
      transcripts_redacted_at: meeting.transcripts_redacted_at&.iso8601,
      transcripts_redacted: meeting.transcripts_redacted_at.present?
    }

    if full
      # 유효 폴더 공유 상태(없으면 nil). 조상 중 하나라도 비공개면 false.
      # EditMeetingDialog에서 "폴더가 비공개라 회의도 숨김" 안내용.
      json[:folder_shared] = meeting.folder&.effectively_shared?
      json[:project_name] = meeting.project&.name
      # 폴더 루트→현재 경로 [{id,name}]. ancestors=루트→부모(자기 제외)라 self 를 끝에 덧붙인다.
      json[:folder_path] = meeting.folder ? (meeting.folder.ancestors + [{ id: meeting.folder.id, name: meeting.folder.name }]) : []
      # 이전 회의 참고: 배지 표시용 (id + 제목). list 응답엔 미포함(N+1 회피).
      json[:previous_meeting_id] = meeting.previous_meeting_id
      json[:previous_meeting_title] = meeting.previous_meeting&.title
      # D'Flow 전송 상태(다이얼로그 초기 상태용) — status 액션 재호출 없이 렌더.
      # dflow_synced_at·dflow_needs_resync 는 목록 배지에도 필요해 always-on 블록으로 옮겼다(위 참고).
      json[:public_uid] = meeting.public_uid
      json[:dflow_url] = meeting.dflow_url
      # transcripts를 한 번만 로드해 max 집계와 직렬화에 재사용(기존 3쿼리 → 1쿼리).
      # 빈 컬렉션이면 max가 nil → to_i로 0 (기존 .maximum(:col).to_i와 동일).
      ordered_transcripts = meeting.transcripts.order(:started_at_ms).to_a
      json[:audio_duration_ms] = cached_audio_duration_ms(meeting)
      json[:last_transcript_end_ms] = ordered_transcripts.map(&:ended_at_ms).max.to_i
      json[:last_sequence_number] = ordered_transcripts.map(&:sequence_number).max.to_i
      json[:transcripts]   = serialize_transcripts(ordered_transcripts)
      json[:summary]       = serialize_summary(meeting)
      # 연결 회의 시드 각인(⟦m:<id>/t:..⟧) 출처 회의ID → 제목 맵. 프론트가 인용 마커를 inert
      # 배지로 렌더할 때 표시용 제목을 얻는다. 연쇄 연결(A→B→C)이면 여러 id가 한 문서에
      # 공존할 수 있어 전부 스캔한다.
      json[:citation_meetings] = citation_meetings_map(meeting)
    end

    json
  end

  def serialize_transcripts(transcripts)
    transcripts.map do |t|
      {
        id: t.id,
        content: t.content,
        speaker_label: t.speaker_label,
        speaker_name: t.speaker_name,
        sequence_number: t.sequence_number,
        started_at_ms: t.started_at_ms,
        ended_at_ms: t.ended_at_ms
      }
    end
  end

  def serialize_summary(meeting)
    summary = meeting.active_summary
    return nil unless summary

    serialize_summary_hash(summary)
  end

  def serialize_summary_hash(summary)
    {
      id: summary.id,
      summary_type: summary.summary_type,
      key_points: parse_json_field(summary.key_points),
      decisions: parse_json_field(summary.decisions),
      discussion_details: parse_json_field(summary.discussion_details),
      notes_markdown: summary.notes_markdown,
      generated_at: summary.generated_at
    }
  end

  def parse_json_field(value)
    return [] if value.nil?
    return value if value.is_a?(Array)
    JSON.parse(value)
  rescue JSON::ParserError
    []
  end

  # 반복 규칙(JSON 텍스트)을 객체/해시로 파싱한다. 없거나 깨진 값은 nil(배열 기본인 parse_json_field 와 다름).
  def parse_recurrence_rule(value)
    return nil if value.blank?
    JSON.parse(value)
  rescue JSON::ParserError
    nil
  end

  # 활성 요약 텍스트에서 ⟦m:<id>/t:..⟧ 마커의 회의id를 전부 스캔해 제목을 조회한다.
  # 삭제됐거나 현재 사용자가 접근할 수 없는 회의는 맵에서 제외한다(프론트가 없는 id는
  # "이전 회의" 폴백으로 표시하므로 제외로 충분 — 별도 플레이스홀더 불필요).
  #
  # 인가 기준은 단건 열람(authorize_meeting_read!, meeting_lookup.rb:20-28)과 동등해야 한다.
  # accessible_by 스코프만으로는 admin/소유자/(프로젝트멤버 && shared)만 걸러지고 idea 44 협업자
  # (직접 지정·폴더 상속)가 빠진다 — 폴더 상속 협업자가 shared:false 이전 회의를 연결한 경우
  # 실열람 가능한데도 맵에서 제외돼 프론트가 "이전 회의" 폴백을 잘못 노출한다.
  def citation_meetings_map(meeting)
    text = meeting.active_summary&.notes_markdown
    return {} if text.blank?

    ids = LlmPrompts::CitationMarkers.referenced_meeting_ids(text)
    return {} if ids.empty?

    result = Meeting.accessible_by(current_user).where(id: ids).pluck(:id, :title).to_h
    remaining_ids = ids - result.keys
    return result if remaining_ids.empty?

    # accessible_by 밖으로 걸러진 나머지만 협업자 분기로 보강한다(보통 0~소수건 — 새 권한 로직을
    # 발명하지 않고 MeetingLookup#meeting_collaborator? 를 그대로 재사용해 인가 기준을 단일화).
    Meeting.kept.where(id: remaining_ids).each do |candidate|
      result[candidate.id] = candidate.title if meeting_collaborator?(candidate)
    end
    result
  end

  # 파일 전사 대기열 잡 스냅샷 — 컨트롤러 인스턴스(=요청) 단위로 1회만 조회해 meeting_json
  # 반복 호출(index/scheduled 목록) 간 재사용한다. defined? 가드로 "조회했더니 빈 배열이었다"와
  # "아직 조회 전"을 구분(||= 는 빈 배열이 truthy라 문제없지만 의도를 명시).
  # StatementInvalid(dev/test :async 어댑터, 큐 테이블 없음)는 빈 배열로 흡수 — 이후
  # Meeting#transcription_queue_position(jobs) 는 이미 받은 배열을 쓰므로 개별 rescue를 타지 않는다.
  def transcription_queue_jobs_snapshot
    return @transcription_queue_jobs_snapshot if defined?(@transcription_queue_jobs_snapshot)
    @transcription_queue_jobs_snapshot = begin
      Meeting.unfinished_transcription_queue_jobs
    rescue ActiveRecord::StatementInvalid
      []
    end
  end

  # audio_duration_ms 컬럼 우선. 컬럼이 비어있는 레거시 회의만 한 번 측정해 캐시한다
  # (완료 회의의 오디오 파일은 불변이라 안전 — 이후 조회는 컬럼만 읽어 ffprobe 제거).
  def cached_audio_duration_ms(meeting)
    return meeting.audio_duration_ms unless meeting.audio_duration_ms.nil?

    duration = meeting.measure_audio_duration_ms
    if meeting.audio_file_path.present? && File.exist?(meeting.audio_file_path)
      meeting.update_column(:audio_duration_ms, duration)
    end
    duration
  end
end

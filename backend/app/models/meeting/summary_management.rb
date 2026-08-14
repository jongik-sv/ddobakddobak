# 요약(Summary) 선택·시드·진행상태·실패기록·미리보기 추출.
#
# 주의: 이전 회의 응축 캐시(condense_previous_meeting_body / previous_condense_digest /
# CONDENSE_CACHE_VERSION)는 이 concern으로 옮기지 않고 Meeting 본체(private)에 남겨둔다 —
# spec/models/meeting_condense_cache_spec.rb 가 `stub_const("Meeting::CONDENSE_CACHE_VERSION", ...)`
# 로 스텁하는데, RSpec 상수 스텁은 `const_defined?(name, false)`(inherit: false)로만 확인하므로
# include된 모듈에 정의된 상수는 "미정의"로 보고 Meeting 위에 새 상수를 얹는다 — 그러면 이 concern
# 안의 코드가 실제로 참조하는(렉시컬 스코프인) 상수는 그대로 남아 캐시 무효화 테스트가 깨진다.
module Meeting::SummaryManagement
  extend ActiveSupport::Concern

  # completed 회의만 final 을 하드 우선. reopen(=recording 복귀) 후엔 최신 우선 —
  # stale final 이 reopen 후 쌓이는 realtime 진행분을 가리지 않게 (구현리뷰 useredit-M5).
  #
  # loaded-aware: summaries 가 이미 로드돼 있으면(목록 preload) in-memory 로 고른다 — 매번 SQL을
  # 치던 걸 없애 목록 N건에서 N+1을 막는다(meeting_attachments.loaded? 와 동일 관용구,
  # meeting_serializable.rb 참고). in-memory 분기는 SQL 분기와 정확히 같은 레코드를 골라야 한다:
  # - completed? 인 최소 id final(= 바인딩 없는 bare find_by 의 rowid/id 순서를 미러링)
  # - fallback은 [generated_at, id] 최댓값(= order(generated_at: :desc, id: :desc).first 와 동일)
  def active_summary
    if summaries.loaded?
      if completed?
        finals = summaries.select { |s| s.summary_type == "final" }
        finals.min_by(&:id) || summaries.max_by { |s| [ s.generated_at, s.id ] }
      else
        summaries.max_by { |s| [ s.generated_at, s.id ] }
      end
    else
      if completed?
        summaries.find_by(summary_type: "final") ||
          summaries.order(generated_at: :desc, id: :desc).first
      else
        summaries.order(generated_at: :desc, id: :desc).first
      end
    end
  end

  def current_notes_markdown
    active_summary&.notes_markdown.to_s
  end

  # 이전 회의 참고 시드: 이 회의에 요약이 아직 없고 previous_meeting 이 지정돼 있으면,
  # 이전 회의록을 "상단 고정 압축 요약 블록"으로 깐 초기 Summary 1건을 만든다.
  # 이후 요약 잡(realtime/final)은 이 상단 블록을 절대 재작성하지 않고(코드 레벨 보호,
  # PreviousMeetingNotes.split/join), 절취선 아래 본문만 이어쓴다.
  # 멱등: 요약이 하나라도 있으면 no-op (시드는 단 한 번). 스냅샷이므로 이후 이전 회의가 바뀌어도 고정.
  #
  # 연쇄 연결(A→B→C…) 지원: 이전 회의(previous_meeting) 문서 자체가 이미 절취선을 갖고 있으면
  # (= previous 도 자신의 이전 회의를 연결한 경우) 그 상단 블록들은 재압축 없이 그대로 승계하고,
  # 이전 회의의 하단 본문만 이번에 1회 압축해 새 블록으로 뒤에 추가한다 — 각 회의는 정확히
  # 1회만 압축되고 이후 불변. previous 문서에 절취선이 없으면(구 데이터·비연쇄) 문서 전체를
  # 압축 대상 본문으로 취급한다.
  #
  # 문서 제목(H1)은 이 회의(현재 회의) 자신의 제목이 "이전 회의 요약"보다 먼저 나와야 한다
  # (사용자 실사용 피드백). previous 의 top 에 그 회의 자신의 제목 H1 이 실려 있을 수 있으므로
  # (연쇄 승계) #strip_leading_h1 로 그 제목을 걷어낸 HEADER+블록 부분만 승계하고, 그 위에
  # #with_title 로 이 회의의 제목을 새로 얹는다 — 연결 몇 단을 거쳐도 top 에는 항상 "현재
  # 연결하는 회의"의 제목 H1 하나만 존재한다.
  def seed_summary_from_previous!(summary_type: "realtime")
    return if summaries.exists?
    return if previous_meeting_id.blank?

    base = previous_meeting&.current_notes_markdown.to_s
    return if base.blank?

    prev_top, prev_body = PreviousMeetingNotes.split(base)
    prev_header = PreviousMeetingNotes.strip_leading_h1(prev_top).presence
    # 이전 회의 스코프 마커(⟦t:..⟧)에 출처 회의ID를 각인(⟦m:<id>/t:..⟧) — 프론트가 현재 오디오
    # 기준으로 엉뚱하게 seek하지 않도록 inert 배지로 구분한다. 이미 m: 인 마커(연쇄 승계분)는
    # prev_header 에 남아 있고 여기서 건드리지 않는다 — 원출처가 각인 시각에 고정된다.
    stamped_body = LlmPrompts::CitationMarkers.stamp_source_meeting(prev_body, previous_meeting_id)
    prev_title = previous_meeting.title.to_s.strip.presence || "이전 회의"

    condensed = condense_previous_meeting_body(stamped_body, prev_title)
    block_body = condensed.presence || stamped_body.strip

    new_top = PreviousMeetingNotes.append_block(prev_header, prev_title, block_body)
    new_top = PreviousMeetingNotes.with_title(title, new_top)
    doc = PreviousMeetingNotes.join(new_top, "")

    summaries.create!(summary_type: summary_type, notes_markdown: doc.rstrip, generated_at: Time.current)
  end

  # 트랜스크립트·요약·블록(선택적으로 첨부)을 모두 삭제한다.
  def purge_transcription_content!(include_attachments: false)
    transcripts.destroy_all
    summaries.destroy_all
    blocks.destroy_all
    if include_attachments
      meeting_attachments.destroy_all
      # 첨부가 통째로 사라지므로 그 첨부에서 파생된 안건/이해관계자 압축 캐시와
      # "realtime 에 이미 1회 주입했다"는 applied_at 플래그도 함께 고아 상태로 남기면 안 된다.
      # 남으면 재업로드 후에도(재계산 잡이 아직 안 돌았거나 재업로드 자체가 없는 경우) 플래그가
      # 이미 present 라 realtime 1회 주입이 다시 일어나지 않는다. AgendaReferenceJob/
      # StakeholderReferenceJob 이 "첨부 없음" 시 취하는 것과 동일한 nil 상태로 되돌린다.
      update_columns(
        agenda_reference: nil, agenda_reference_applied_at: nil,
        stakeholder_reference: nil, stakeholder_reference_applied_at: nil
      )
    end
    # 콘텐츠 초기화(reset_content·재전사) 시 이전 요약 실패 기록도 함께 클리어 —
    # 잔존하면 초기화된 회의에 오탐 실패 배지가 영구 노출된다.
    clear_summary_error!
  end

  # ── 요약 실패 레포트 (summary_error) ──
  # 영속 기록의 메시지 상한 — broadcast·meeting_json 노출 공통(과대 메시지 방어).
  SUMMARY_ERROR_MESSAGE_MAX = 500

  # 요약(LLM) final 실패 영속 기록 — meeting_json 으로 노출돼 새로고침 후에도 사용자가
  # 실패를 알 수 있다. MeetingSummarizationJob 과 FileTranscriptionJob(파일 전사 경유
  # final)이 공유하는 단일 진입점. update_columns: 콜백·updated_at 오염 방지.
  def record_summary_error!(message)
    update_columns(
      summary_error_message: message.to_s.truncate(SUMMARY_ERROR_MESSAGE_MAX),
      summary_error_at: Time.current
    )
  end

  # 성공 저장 시 이전 실패 기록 클리어 — 기록이 없으면 쓰기 생략(매 틱 불필요한 UPDATE 방지).
  def clear_summary_error!
    return if summary_error_message.nil? && summary_error_at.nil?
    update_columns(summary_error_message: nil, summary_error_at: nil)
  end

  # ── 요약 진행 중 상태 (summarizing) ──
  # regenerate_notes/summarize/final/realtime 요약이 실행 중임을 회의 모델에 영속화한다.
  # 회의 상세 배지뿐 아니라 회의목록(StatusBadge)에서도 새로고침·페이지 이탈 후에도 "요약중"
  # 상태를 유지하기 위한 단일 진입점. MeetingSummarizationJob 의 시작/종료 브로드캐스트
  # 지점에서만 토글된다(동시성 제한으로 같은 회의 중복 실행이 없어 시작/종료 짝이 안전).
  # update_columns: 콜백·updated_at 오염 방지(record_summary_error! 와 동일 패턴).
  def record_summary_start!
    update_columns(summarizing: true, summarization_started_at: Time.current)
  end

  # 종료 해제는 멱등 — 시작하지 않은 회의(broadcast_finished 만 온 give-up 경로)에
  # 호출돼도 false 유지로 무해하다. summarization_started_at 도 함께 클리어.
  def record_summary_finished!
    update_columns(summarizing: false, summarization_started_at: nil)
  end

  # notes_markdown에서 의미 있는 요약 텍스트를 추출하여 brief_summary 컬럼에 저장.
  # 단일 진입점에서 절취선 상단(연결 회의 상단 고정 요약)을 항상 걷어내고 본문만 추출 대상으로
  # 삼는다 — 안 그러면 연결 회의의 목록 미리보기가 "이 회의 자신의 내용" 대신 이전 회의 내용을
  # 보여줄 수 있다. 호출부가 이미 본문만 넘겨도(job.rb) PreviousMeetingNotes.split 은 절취선이
  # 없는 텍스트에 no-op(그대로 반환)이라 이중 적용해도 안전하다 — 호출부마다 분할을 기억할
  # 필요 없이 이 메서드 하나가 항상 보장한다.
  def refresh_brief_summary!(notes_markdown = nil)
    notes_markdown ||= (summaries.find_by(summary_type: "final") ||
                        summaries.order(generated_at: :desc).first)&.notes_markdown
    return if notes_markdown.blank?

    _top, body = PreviousMeetingNotes.split(notes_markdown)
    return if body.blank?

    text = self.class.extract_brief_summary(body)
    update_column(:brief_summary, text) if text.present?
  end

  class_methods do
    def extract_brief_summary(notes_markdown, max_length: 150)
      # 인용 마커(⟦t:…⟧, ⟦m:…⟧) 제거 — 절단 전에 지워야 반토막 마커가 남지 않는다
      notes_markdown = notes_markdown.gsub(/⟦[^⟧]*⟧/, "").gsub(/[ \t]{2,}/, " ")
      lines = notes_markdown.lines.map(&:strip).reject(&:empty?)

      # 마크다운 헤더, 구분선, 빈 블릿 등 건너뛰고 실제 내용 추출
      content_lines = lines.reject { |l|
        l.match?(/\A\#{1,6}\s/) ||      # 헤더
        l.match?(/\A[-=*]{3,}\z/) ||     # 구분선
        l.match?(/\A```/) ||             # 코드블록
        l.match?(/\A\|/)                 # 테이블
      }.map { |l|
        l.gsub(/\A[-*+]\s+/, "")        # 불릿 마커 제거
         .gsub(/\*\*(.+?)\*\*/, '\1')   # 볼드 제거
         .gsub(/[*_~`>]/, "")           # 나머지 마크다운 기호 제거
         .strip
      }.reject(&:empty?)

      return nil if content_lines.empty?

      # 첫 2~3줄을 합쳐서 의미 있는 길이 확보
      result = ""
      content_lines.each do |line|
        candidate = result.empty? ? line : "#{result} #{line}"
        if candidate.length > max_length
          result = result.empty? ? "#{line[0...max_length]}..." : result
          break
        end
        result = candidate
      end

      result.presence
    end
  end
end

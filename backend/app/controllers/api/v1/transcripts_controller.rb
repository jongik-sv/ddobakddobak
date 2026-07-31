module Api
  module V1
    class TranscriptsController < ApplicationController
      include MeetingLookup
      include TranscriptSerializable
      include MeetingWriteGuard

      before_action :authenticate_user!
      before_action :set_meeting
      before_action :authorize_meeting_control!, only: %i[destroy_batch bulk_create update_content split]
      # 절단은 복구 불가한 기밀 파기 + 오디오 재인코딩을 동반하므로 협업자를 제외한다
      # (idea 44: 관리 액션 = owner/admin). split 은 "편집"이라 control 티어를 유지한다.
      before_action :authorize_meeting_admin!, only: %i[redact]
      before_action :reject_if_locked!, only: %i[bulk_create update_content destroy_batch split redact]

      def index
        transcripts = @meeting.transcripts.order(:sequence_number)
        render json: {
          transcripts: transcripts.map { |t| transcript_json(t) }
        }
      end

      def destroy_batch
        ids = Array(params[:ids]).map(&:to_i)
        return render json: { error: "ids required" }, status: :unprocessable_entity if ids.empty?

        # destroy_all(콜백 경유)을 써야 after_destroy :fts_delete 가 돌아 FTS 인덱스에서도 지워진다.
        # delete_all은 콜백을 건너뛰어 삭제한 발언의 평문이 transcripts_fts에 그대로 남는다.
        deleted_count = @meeting.transcripts.where(id: ids).destroy_all.length
        # 실제로 지운 행이 있을 때만 갱신 — apply_glossary_entry(meetings_controller.rb:661-664)도
        # notes가 실제로 바뀐 경우에만 last_user_edit_at을 갱신하는 것과 같은 원칙이다.
        # 존재하지 않는 id만 보낸 요청까지 갱신하면 아무것도 안 바뀌었는데 D'Flow가 재전송
        # 대상으로 오판(dflow_needs_resync?)한다.
        @meeting.update!(last_user_edit_at: Time.current) if deleted_count.positive?
        render json: { deleted: deleted_count }
      end

      # POST /api/v1/meetings/:meeting_id/transcripts/bulk
      # 온디바이스(로컬) STT 결과를 서버에 영속화한다.
      # body: { transcripts: [{ content, speaker_label, started_at_ms,
      #                         ended_at_ms, sequence_number, audio_source }] }
      # 멱등: (meeting_id, sequence_number) 기준 find_or_initialize → update.
      # 같은 sequence_number 재전송 시 중복 행을 만들지 않고 갱신만 한다.
      def bulk_create
        items = params[:transcripts]
        unless items.is_a?(Array)
          return render json: { error: "transcripts array required" }, status: :unprocessable_entity
        end

        saved = []
        ActiveRecord::Base.transaction do
          items.each do |raw|
            attrs = bulk_transcript_attrs(raw)
            next if attrs.nil?

            transcript = @meeting.transcripts.find_or_initialize_by(
              sequence_number: attrs[:sequence_number]
            )
            transcript.assign_attributes(attrs)
            # speaker_label은 로컬 단일/미상 화자에서 빈 문자열("")이 정상값이라
            # 모델의 presence 검증을 우회한다. content/시간 필드는 위에서 직접 가드.
            transcript.save!(validate: false)
            saved << transcript
          end
        end

        saved.each do |transcript|
          ActionCable.server.broadcast(
            @meeting.transcription_stream,
            {
              id: transcript.id,
              type: "final",
              text: transcript.content,
              speaker: transcript.speaker_label,
              audio_source: transcript.audio_source,
              started_at_ms: transcript.started_at_ms,
              ended_at_ms: transcript.ended_at_ms,
              seq: transcript.sequence_number,
              created_at: transcript.created_at.iso8601
            }
          )
        end

        render json: {
          created: saved.length,
          transcripts: saved.map { |t| transcript_json(t) }
        }
      end

      def update_content
        content = params[:content].to_s
        trimmed = content.strip
        if trimmed.empty?
          return render json: { error: "content blank" }, status: :unprocessable_entity
        end
        if content.length > 5000
          return render json: { error: "content too long" }, status: :unprocessable_entity
        end

        transcript = @meeting.transcripts.find_by(id: params[:id])
        return render json: { error: "Transcript not found" }, status: :not_found unless transcript

        transcript.update!(content: content)
        transcript.meeting.reconcile_embeddings!
        @meeting.update!(last_user_edit_at: Time.current)

        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          {
            type: "transcript_updated",
            id: transcript.id,
            content: transcript.content,
            client_id: params[:client_id]
          }
        )

        render json: { transcript: transcript_json(transcript) }
      end

      # POST /api/v1/meetings/:meeting_id/transcripts/:id/split
      # 한 전사 행에 섞인 두 화자 발언을 사람이 지정한 지점(오디오 ms + 텍스트 문자 인덱스)에서
      # 두 행으로 쪼갠다. 2분할만 지원(3인 이상은 두 번 호출). 상세 설계:
      # docs/superpowers/specs/2026-07-30-transcript-split-design.md
      def split
        transcript = @meeting.transcripts.find_by(id: params[:id])
        return render json: { error: "Transcript not found" }, status: :not_found unless transcript

        # 진행 중인 회의는 split 금지 — 이유가 각각 다르다(설계 문서 "검증" 절 참조):
        # recording은 bulk_create 멱등키(sequence_number)와 재번호가 충돌하고,
        # transcribing은 파일 전사가 행을 계속 만들어 sequence_number가 유동적이다.
        if @meeting.recording? || @meeting.transcribing?
          return render json: { error: "녹음 또는 전사 중에는 분할할 수 없습니다." }, status: :conflict
        end
        # 요약 잡이 applied_to_minutes: false 행을 읽는 중이라, 그 사이 행을 쪼개면
        # append 대상이 어긋난다(meeting_summarization_job.rb).
        if @meeting.summarizing?
          return render json: { error: "요약 중에는 분할할 수 없습니다." }, status: :conflict
        end

        # expected_content 검증이 최우선이어야 한다 — 다이얼로그가 열려 있는 동안 다른 클라이언트가
        # update_content를 호출했을 수 있고, 그러면 split_index는 이미 사라진 텍스트 기준이 된다.
        # update_content에는 버전·etag가 없으므로 원문 전체를 비교해 어긋나면 아무 행도 바꾸지 않고 409.
        expected_content = params[:expected_content].to_s
        if expected_content != transcript.content
          return render json: { error: "다른 곳에서 이 발언이 수정되었습니다. 다시 시도하세요." }, status: :conflict
        end

        content = transcript.content
        split_ms = params[:split_ms]
        split_index = params[:split_index]

        # Hash/Array 등으로 오면 .to_i가 없어 NoMethodError → 500이 샌다. String/Numeric으로
        # 좁힌 뒤에만 .to_i를 호출한다(잘못된 타입도 "범위 밖"과 같은 422로 취급).
        unless scalar_param?(split_ms)
          return render json: { error: "split_ms out of range" }, status: :unprocessable_entity
        end
        split_ms_i = split_ms.to_i
        unless split_ms.present? && split_ms_i > transcript.started_at_ms && split_ms_i < transcript.ended_at_ms
          return render json: { error: "split_ms out of range" }, status: :unprocessable_entity
        end

        unless scalar_param?(split_index)
          return render json: { error: "split_index out of range" }, status: :unprocessable_entity
        end
        split_index_i = split_index.to_i
        unless split_index.present? && split_index_i > 0 && split_index_i < content.length
          return render json: { error: "split_index out of range" }, status: :unprocessable_entity
        end

        first_content = content[0...split_index_i].to_s.strip
        second_content = content[split_index_i..].to_s.strip
        if first_content.blank? || second_content.blank?
          return render json: { error: "split produces blank content" }, status: :unprocessable_entity
        end

        first_attrs = split_side_attrs(params[:first], transcript)
        second_attrs = split_side_attrs(params[:second], transcript)
        # "지정 시" non-blank — 생략(승계)된 값까지 여기서 막지는 않는다. bulk_create가
        # 온디바이스 단일/미상 화자 행을 speaker_label: ""로 저장할 수 있으므로(save!(validate: false)),
        # 그런 행을 화자 지정 없이(승계) split하면 이 사전 체크로는 걸리지 않아야 한다.
        # 명시적으로 빈 값을 지정한 경우만 미리 422로 막는다.
        if explicit_blank_speaker_label?(params[:first], first_attrs) ||
           explicit_blank_speaker_label?(params[:second], second_attrs)
          return render json: { error: "speaker_label required" }, status: :unprocessable_entity
        end

        # 분할 전 원행 값을 스냅샷 — 조각2는 원행을 destroy하지 않고 새로 create하므로,
        # 원행이 조각1로 update!된 뒤에도 조각2가 참조할 값(ended_at_ms/audio_source/
        # applied_to_minutes/sequence_number)을 미리 잡아둔다.
        orig_sequence = transcript.sequence_number
        orig_ended_at_ms = transcript.ended_at_ms
        orig_audio_source = transcript.audio_source
        orig_applied_to_minutes = transcript.applied_to_minutes

        inserted = nil
        begin
          ActiveRecord::Base.transaction do
            # 뒤 행 재번호. reorder(nil) 필수 — Transcript.default_scope { order(:sequence_number) }가
            # 관계에 남아 update_all에 ORDER BY가 붙으면 SQLite가 컴파일 플래그 없이 거부한다.
            # @meeting.transcripts 대신 Transcript.where(meeting_id:)로 시작하는 것도 같은 이유.
            Transcript.where(meeting_id: @meeting.id)
                      .where("sequence_number > ?", orig_sequence)
                      .reorder(nil)
                      .update_all("sequence_number = sequence_number + 1")

            # 원행을 destroy하지 않고 조각1로 update! — FTS delete/insert 왕복·임베딩 행 신규 생성·
            # rowid 재사용·프론트 스토어 id 스플라이스를 모두 피한다. after_save :fts_upsert가
            # 인덱스를 갱신한다(콜백이라 update_all과 달리 안전).
            transcript.update!(
              content: first_content,
              ended_at_ms: split_ms_i,
              speaker_label: first_attrs[:speaker_label],
              speaker_name: first_attrs[:speaker_name]
            )

            inserted = @meeting.transcripts.create!(
              content: second_content,
              speaker_label: second_attrs[:speaker_label],
              speaker_name: second_attrs[:speaker_name],
              started_at_ms: split_ms_i,
              ended_at_ms: orig_ended_at_ms,
              sequence_number: orig_sequence + 1,
              audio_source: orig_audio_source,
              applied_to_minutes: orig_applied_to_minutes
            )
          end
        rescue ActiveRecord::RecordInvalid => e
          # 승계된(생략된) speaker_label이 이미 ""인 온디바이스 행처럼, 사전 체크를 통과했지만
          # 모델 검증에는 걸리는 잔여 케이스 — 트랜잭션은 롤백되었으니 422로 되돌린다(500 방지).
          return render json: { error: e.message }, status: :unprocessable_entity
        end

        @meeting.reconcile_embeddings!
        @meeting.update!(last_user_edit_at: Time.current)

        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          {
            type: "transcript_split",
            updated: transcript_json(transcript),
            inserted: transcript_json(inserted),
            client_id: params[:client_id]
          }
        )

        render json: { updated: transcript_json(transcript), inserted: transcript_json(inserted) }
      end

      # POST /api/v1/meetings/:meeting_id/transcripts/redact
      # 선택한 전사 행과 그 구간의 오디오를 실제로 파기한다. 마스킹이 아니라 절단이며 되돌릴 수 없다.
      # 설계: docs/superpowers/specs/2026-07-31-transcript-redact-range-design.md
      def redact
        raw_ids = Array(params[:transcript_ids])
        # 비스칼라 원소를 조용히 버리면 **부분 절단**이 된다 — 사용자는 전부 지웠다고 믿는데
        # 일부 기밀 행이 남는다. 하나라도 이상하면 아무것도 하지 않고 422.
        unless raw_ids.all? { |v| scalar_param?(v) }
          return render json: { error: "transcript_ids must be integers" }, status: :unprocessable_entity
        end
        ids = raw_ids.map(&:to_i).uniq
        return render json: { error: "transcript_ids required" }, status: :unprocessable_entity if ids.empty?

        # 진행 상태 가드는 split 과 동일한 이유(재번호 충돌 / 행이 계속 생성 중 / 요약 append 대상 어긋남).
        if @meeting.recording? || @meeting.transcribing?
          return render json: { error: "녹음 또는 전사 중에는 절단할 수 없습니다." }, status: :conflict
        end
        if @meeting.summarizing?
          return render json: { error: "요약 중에는 절단할 수 없습니다." }, status: :conflict
        end
        # 값싼 조기 409(UX)일 뿐 보증이 아니다 — 실제 경합은 AudioUploadJob 의 소스 identity 검증이
        # 닫는다(dev/test 는 :async 어댑터라 이 조회가 항상 false 다).
        if AudioUploadJob.in_flight_for?(@meeting.id)
          return render json: { error: "오디오 변환이 진행 중입니다. 잠시 후 다시 시도하세요." }, status: :conflict
        end

        rows = Transcript.where(meeting_id: @meeting.id).order(:sequence_number).to_a
        unknown = ids - rows.map(&:id)
        if unknown.any?
          return render json: { error: "transcript not found: #{unknown.join(', ')}" },
                        status: :unprocessable_entity
        end

        # 동시 split 가드 (설계 §낙관적 동시성 가드 (1)). 클라이언트가 화면에서 본 각 선택 행의 ms
        # 경계를 되돌려 보내고, 서버 현재값과 하나라도 다르면 아무것도 바꾸지 않고 409.
        # **required 다** — 없으면 422. optional 로 두면 클라이언트가 필드를 빠뜨렸을 때 가드가
        # 통째로 사라지고, 기밀 파기 기능에서 그 실패 모드는 허용되지 않는다.
        # 아래 겹침 완전성 검사로는 이 케이스를 잡을 수 없다: split 은 원행의 ended_at_ms 를
        # 분할점으로 줄이고 새 조각이 정확히 그 지점에서 시작하므로 gap 이 0 이 되어 클램프된
        # 경계가 새 조각과 겹치지 않는다 → 검사를 통과하고 절반만 잘려 기밀이 살아남는다.
        expected = params[:expected_bounds]
        unless expected.respond_to?(:[]) && expected.respond_to?(:key?)
          return render json: { error: "expected_bounds required" }, status: :unprocessable_entity
        end
        # 항목 **누락**과 값 **불일치**를 구분한다. 누락은 클라이언트 결함이라 새로고침해도 안 낫는다
        # (422). 불일치만 "다른 곳에서 바뀜"이라 재조회로 회복 가능한 409다.
        selected_rows = rows.select { |row| ids.include?(row.id) }
        missing_bounds = selected_rows.reject { |row| bounds_entry(expected, row.id) }
        if missing_bounds.any?
          return render json: { error: "expected_bounds missing for: #{missing_bounds.map(&:id).join(', ')}" },
                        status: :unprocessable_entity
        end
        if selected_rows.any? { |row| bounds_stale?(expected, row) }
          return render json: { error: "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요." },
                        status: :conflict
        end

        # 절단 경계는 실측 오디오 길이 기준이어야 한다. audio_duration_ms 는 전사 ms 파생이 아니고
        # (meeting.rb:117-132) stale 이면 마지막 구간의 cut_end 와 ffprobe 길이 검증이 함께 어긋난다.
        # ⚠️ 여기서 컬럼에 **쓰지 않는다**. refresh_audio_duration! 은 update_column 이라, 아래
        # 완전성 검사(409)·cut_to_temp(422)·트랜잭션 롤백처럼 "아무것도 바뀌지 않았다"고 응답하는
        # 경로에서도 컬럼만 이미 바뀐 상태가 된다. 로컬로 재서 플랜에 넘기고 성공 경로에서만 영속한다.
        audio_duration_ms = @meeting.measure_audio_duration_ms
        redactor = AudioRedactor.new(@meeting)

        # ⭐ fail-closed: 오디오 파일은 디스크에 있는데 길이를 재지 못했다(손상·ffprobe 실패·ffmpeg
        # 부재). 이때 kept_segments 는 정의상 빈 배열이 되는데, 아래 `kept.empty?` 분기의 뜻은
        # "전사 전체 선택 = 오디오를 통째로 파기"다 — 즉 **한 행만 고른 요청이 오디오 전체를
        # 파기한다**. 길이를 모르면 어디를 잘라야 하는지도 모른다. 파괴적·복구 불가 연산이므로
        # 진행하지 않는다. 서버 오디오가 애초에 없는 회의(온디바이스 STT)는 audio_paths 가 비어
        # 여기에 걸리지 않고 전사만 정상 파기된다.
        if audio_duration_ms.zero? && redactor.audio_paths.any?
          return render json: { error: "오디오 길이를 측정할 수 없어 절단할 수 없습니다." },
                        status: :unprocessable_entity
        end

        plan = TranscriptRedactionPlan.new(
          rows: rows, selected_ids: ids, audio_duration_ms: audio_duration_ms
        )
        # ⭐ 두 불변식은 원인도 회복 가능성도 다르므로 상태 코드를 나눈다(plan 주석 §complete?).
        # uncovered_selected_ids = 선택 행이 계산된 절단 구간 밖 = 경계 계산이 깨졌다. 새로고침해도
        # 낫지 않으므로 409("다른 곳에서 바뀜")로 내보내면 데이터 손상에 대해 거짓말을 하는 셈이고
        # 사용자는 새로고침만 반복한다. 오디오는 엉뚱한 데를 자르고 기밀 전사가 살아남는 경로다.
        if plan.uncovered_selected_ids.any?
          return render json: { error: "절단 구간 계산이 올바르지 않아 중단했습니다. 관리자에게 문의하세요." },
                        status: :unprocessable_entity
        end
        if plan.unselected_overlapping_ids.any?
          return render json: { error: "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요." },
                        status: :conflict
        end

        kept = plan.kept_segments
        tmp_map = {}
        begin
          # 중복 기밀 사본 선삭제 — 트랜잭션·ffmpeg 보다 먼저(V6-b). 남겨두면 finalize 가 잘리지 않은
          # 청크로 오디오를 재구성한다. 롤백돼도 무해하다(본 오디오에 이미 병합된 중복).
          # 여기서 이전 절단이 남긴 .redact-backup(= 절단 전 원음)도 함께 쓸어낸다. 이 호출이
          # swap_in! 보다 먼저여야 이번 실행의 백업이 살아남아 롤백 복구가 가능하다 — 순서 고정.
          redactor.purge_duplicate_sources!
          tmp_map = redactor.cut_to_temp(kept, plan.total_cut_ms) if kept.any?
        rescue AudioRedactor::Error => e
          # 여기서 중단하면 DB 는 무변경이다.
          return render json: { error: e.message }, status: :unprocessable_entity
        end

        summaries_destroyed = false
        chat_markers_updated = 0
        bookmarks_removed = 0
        begin
          ActiveRecord::Base.transaction do
            # ⭐ 트랜잭션 안에서 재검증. cut_to_temp 는 -c copy 가 불가해 1시간 mp3 면 수십 초
            # 걸리고, redact 는 아무 상태 플래그도 세우지 않으며 진행 상태 가드는
            # recording?/transcribing?/summarizing? 뿐이다. 그 창으로 split·bulk_create(이어녹음)·
            # destroy_batch 가 그대로 들어온다. 재검증이 없으면 destroy_all 이 **스냅샷 ids 만**
            # 지워 새 조각이 기밀 텍스트를 안고 살아남고, shift_remaining_transcripts! 도 옛
            # 스냅샷을 써서 그 조각은 ms 시프트도 못 받아 오디오와 어긋난다.
            plan = revalidate_redaction!(ids, expected, plan, audio_duration_ms)

            # ⭐ 전사만 재검증하면 절반이다. swap_in! 은 **절단 전에 캡처한 경로**에 되쓰는데,
            # ffmpeg 이 도는 수십 초 동안 이어녹음 병합(meetings_audio_controller.rb:155 의 mv)이나
            # AudioUploadJob 이 그 경로를 새 파일로 갈아치울 수 있다. 그러면 절단 결과가 **새
            # 오디오를 덮어쓴다**. 소스 identity(경로 + ino/size/mtime)를 여기서 다시 본다.
            unless redactor.source_unchanged?
              raise RedactConflict, "오디오가 변경되었습니다. 새로고침 후 다시 시도하세요."
            end

            # FTS 때문에 destroy_all 필수 — delete_all 은 after_destroy :fts_delete 를 건너뛰어
            # 잘라낸 전사 전문이 transcripts_fts 에 영구히 남는다(이 기능이 막으려는 실패 그 자체).
            @meeting.transcripts.where(id: ids).destroy_all
            # ⭐ 그런데 fts_delete 자체가 best-effort 다 — fts_indexable.rb:46-49 가 예외를 삼키고
            # Rails.logger.warn 만 한다. SQLITE_BUSY(이 저장소에 lock storm 실측 이력 있음)로
            # 실패하면 트랜잭션은 그대로 커밋되고 전사 행은 사라진 채 기밀 평문이 FTS 에
            # 영구히 남으면서 200 이 나간다. 삭제됐는지 직접 확인하고 아니면 롤백한다.
            # (fts_delete 자체는 공유 코드라 이 작업 범위 밖 — 여기서 검증만 한다.)
            verify_fts_purged!("transcripts_fts", ids)

            shift_remaining_transcripts!(plan)
            bookmarks_removed = redact_bookmarks!(plan)
            chat_markers_updated = redact_chat_markers!(plan)

            # 회의록은 마커 보정이 아니라 행 삭제 — realtime 요약이 append 형이라
            # (meeting_summarization_job.rb compose_appended_notes) 전사를 지워도 텍스트가 남는다.
            summary_ids = @meeting.summaries.pluck(:id)
            summaries_destroyed = @meeting.summaries.destroy_all.length.positive?
            # Summary 도 FtsIndexable(summaries_fts) 라 같은 best-effort 문제를 안는다.
            verify_fts_purged!("summaries_fts", summary_ids)
            @meeting.action_items.where(ai_generated: true).destroy_all
            @meeting.decisions.where(ai_generated: true).destroy_all

            # brief_summary 는 명시적 nil. refresh_brief_summary! 가 `if text.present?`(meeting.rb:615)라
            # 재생성 결과가 빈 값이면 옛 발췌가 남고, 이 컬럼은 LIKE 검색 대상이다(meeting.rb:151).
            @meeting.update_column(:brief_summary, nil)
            @meeting.update!(last_user_edit_at: Time.current) # D'Flow 재전송 신호

            # 파일 교체는 트랜잭션 마지막. 교체 실패 → 롤백 → 원본 오디오 온전.
            # 반대 순서(DB 커밋 후 교체)는 교체 실패 시 전사만 사라지고 기밀 오디오가 남는다.
            # peaks 는 여기서 한 번 지운다(멱등) — 커밋 뒤에만 지우면 그 사이 죽었을 때 절단 전
            # 파형이 회수 경로 없이 영구히 서빙된다.
            redactor.purge_peaks!
            if kept.empty?
              redactor.move_all_audio_to_backup! # rm 아님 — 커밋 실패 시 restore 로 되살린다
              @meeting.update_columns(audio_file_path: nil, audio_duration_ms: nil)
            else
              redactor.swap_in!(tmp_map)
            end
          end
        rescue RedactConflict => e
          # 재검증 실패 = 커밋 전이다. 오디오·DB 모두 무변경으로 되돌리고 409.
          redactor.restore_backups!
          tmp_map.each_value { |t| FileUtils.rm_f(t) }
          return render json: { error: e.message }, status: :conflict
        rescue RedactInvariantViolation => e
          # 불변식 위반은 동시 변경이 아니다 — 새로고침으로 낫지 않으므로 409 가 아니라 422.
          redactor.restore_backups!
          tmp_map.each_value { |t| FileUtils.rm_f(t) }
          return render json: { error: e.message }, status: :unprocessable_entity
        rescue StandardError
          # 여기 도달 = 커밋 전 실패. swap_in! 이 일부만 됐어도 전부 원본으로 되돌린다.
          redactor.restore_backups!
          tmp_map.each_value { |t| FileUtils.rm_f(t) }
          raise
        end

        # 커밋 후에만 백업 파기. 이 호출은 rescue 밖이어야 한다 — 커밋된 뒤에 restore_backups! 가
        # 돌면 "전사는 지워졌는데 기밀 오디오는 되살아나는" 금지된 방향이 된다.
        # 실패해도 되살리지 않는다. 대신 남은 백업(= 절단 전 원음)은 (a) 다음 절단의
        # purge_stale_backups! (b) 매시간 SttChunkStorage.sweep! → sweep_redact_backups! 가
        # 회수한다. 사용자에게도 알린다.
        # ⚠️ drop_backups! 는 raise 하지 않는다 — FileUtils.rm_f 가 force:true 라 실패해도 조용히
        # 반환하기 때문이다. 반환값(지우지 못한 경로 목록)으로 판정한다. rescue 는 rm_f 밖의
        # 예기치 못한 예외(권한 조회 실패 등)용으로만 남긴다.
        backup_retained = false
        begin
          retained = redactor.drop_backups!
          if retained.any?
            backup_retained = true
            Rails.logger.error "[redact] meeting=#{@meeting.id} 백업 파기 실패 — 스위퍼가 회수한다: #{retained.join(', ')}"
          end
        rescue StandardError => e
          backup_retained = true
          Rails.logger.error "[redact] meeting=#{@meeting.id} 백업 파기 실패 — 스위퍼가 회수한다: #{e.message}"
        end

        redactor.purge_peaks!
        @meeting.refresh_audio_duration! if kept.any?
        @meeting.reconcile_embeddings!

        payload = {
          deleted_ids: ids,
          ranges: plan.ranges.map { |r| { start_ms: r.start_ms, end_ms: r.end_ms } },
          total_cut_ms: plan.total_cut_ms,
          audio_duration_ms: @meeting.audio_duration_ms.to_i,
          summaries_destroyed: summaries_destroyed,
          chat_markers_updated: chat_markers_updated,
          bookmarks_removed: bookmarks_removed,
          backup_retained: backup_retained
        }

        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          payload.merge(type: "transcript_redacted", client_id: params[:client_id])
        )

        render json: payload
      end

      private

      # split_ms/split_index가 .to_i를 호출해도 안전한 타입(String/Numeric)인지 확인한다.
      # Hash(ActionController::Parameters)나 Array가 오면 .to_i가 정의되지 않아 NoMethodError →
      # 처리되지 않은 500으로 샌다. 여기서 걸러 다른 잘못된 입력과 같은 422로 응답한다.
      def scalar_param?(value)
        value.is_a?(String) || value.is_a?(Numeric)
      end

      # first/second 파라미터 하나를 승계·오버라이드 규칙에 따라 { speaker_label:, speaker_name: }로
      # 정규화한다. 키 자체가 생략되면(nil/blank) 원행 값을 그대로 승계. 키가 있으면 필드 단위로
      # "생략 = 승계", "null 명시 = 비움"을 적용한다.
      def split_side_attrs(side_params, transcript)
        if side_params.blank?
          return { speaker_label: transcript.speaker_label, speaker_name: transcript.speaker_name }
        end

        label = side_params.key?(:speaker_label) ? side_params[:speaker_label].to_s.strip : transcript.speaker_label
        name = side_params.key?(:speaker_name) ? side_params[:speaker_name].presence : transcript.speaker_name
        { speaker_label: label, speaker_name: name }
      end

      # speaker_label이 "지정 시" non-blank 규칙 위반인지 판단한다 — 요청에서 명시적으로 지정한
      # 경우만 여기서 막는다. 키를 생략해 원행 값을 승계한 결과가 blank인 경우(예: bulk_create가
      # save!(validate: false)로 저장한 speaker_label: "" 온디바이스 행)는 여기서 막지 않는다
      # (모델 검증에 맡기고, 그래도 걸리면 트랜잭션 rescue에서 422로 처리한다).
      def explicit_blank_speaker_label?(side_params, attrs)
        side_params.present? && side_params.key?(:speaker_label) && attrs[:speaker_label].to_s.blank?
      end

      # 단일 bulk 아이템을 검증·정규화해 attrs 해시로 반환한다.
      # 유효하지 않으면(내용 공백/길이 초과/필수 숫자 누락) nil을 반환해 스킵한다.
      def bulk_transcript_attrs(raw)
        return nil unless raw.respond_to?(:[])

        content = raw[:content].to_s
        trimmed = content.strip
        return nil if trimmed.empty?
        return nil if content.length > 5000

        seq = raw[:sequence_number]
        started = raw[:started_at_ms]
        ended = raw[:ended_at_ms]
        return nil if seq.nil? || started.nil? || ended.nil?

        source = raw[:audio_source].to_s
        source = "mic" unless %w[mic system].include?(source)

        {
          content: content,
          speaker_label: raw[:speaker_label].to_s, # 빈 문자열("") 허용 = 로컬 단일/미상 화자
          started_at_ms: started.to_i,
          ended_at_ms: ended.to_i,
          sequence_number: seq.to_i,
          audio_source: source
        }
      end

      # 트랜잭션 안 재검증 실패. rescue 에서 409 로 변환한다(500 아님).
      RedactConflict = Class.new(StandardError)
      # 트랜잭션 안 **불변식** 위반(선택 행이 절단 구간 밖). 동시 변경이 아니라 계산이 깨진 것이라
      # 새로고침으로 낫지 않는다 → 422. 409 로 뭉치면 사용자는 새로고침만 반복한다.
      RedactInvariantViolation = Class.new(StandardError)

      # expected_bounds 항목 하나 꺼내기. nil 이면 "누락"(422), 있으면 값 비교 대상(409).
      def bounds_entry(expected, row_id)
        e = expected[row_id.to_s]
        e.respond_to?(:[]) && e.respond_to?(:key?) ? e : nil
      end

      # 값 불일치 판정. `.to_i` 를 쓰면 nil.to_i == 0 이라 started_at_ms 가 0 인 첫 행에서
      # "값이 없음"과 "값이 0"이 같아져 가드가 통과한다 — 키 존재와 정수 파싱을 분리한다.
      def bounds_stale?(expected, row)
        e = bounds_entry(expected, row.id)
        return true if e.nil?

        started = e.key?(:started_at_ms) ? Integer(e[:started_at_ms].to_s, exception: false) : nil
        ended   = e.key?(:ended_at_ms)   ? Integer(e[:ended_at_ms].to_s, exception: false)   : nil
        started != row.started_at_ms || ended != row.ended_at_ms
      end

      # ffmpeg 실행 창(수십 초) 동안 들어온 동시 변경을 트랜잭션 안에서 다시 잡는다.
      # 세 가지를 모두 본다:
      #   (a) expected_bounds — 선택 행이 split 등으로 바뀌었는지
      #   (b) complete?       — 창 안에 새로 삽입·이어녹음된 행이 경계에 걸리는지
      #   (c) 경계 동일성     — 위 둘을 통과해도 경계가 달라졌다면 이미 만든 ffmpeg 산출물이
      #                          무효다. 같다면 그대로 써도 안전하다(이 검사가 재사용을 licence 한다).
      # 반환값은 **재계산된 plan** — 이후 ms 시프트·재번호가 반드시 최신 스냅샷을 쓰게 한다.
      def revalidate_redaction!(ids, expected, original_plan, audio_duration_ms)
        rows = Transcript.where(meeting_id: @meeting.id).order(:sequence_number).to_a
        if (ids - rows.map(&:id)).any?
          raise RedactConflict, "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요."
        end

        selected = rows.select { |row| ids.include?(row.id) }
        if selected.any? { |row| bounds_stale?(expected, row) }
          raise RedactConflict, "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요."
        end

        # ⚠️ 컬럼이 아니라 **요청 시작 시 실측한 로컬 값**을 쓴다. 컬럼을 읽으면 이 요청이 아직
        # 영속하지 않은 값(성공 경로에서만 쓴다)이라 original_plan 과 경계가 어긋나 아래
        # range_bounds 비교가 스스로 409 를 만든다.
        plan = TranscriptRedactionPlan.new(
          rows: rows, selected_ids: ids, audio_duration_ms: audio_duration_ms
        )
        if plan.uncovered_selected_ids.any?
          raise RedactInvariantViolation, "절단 구간 계산이 올바르지 않아 중단했습니다. 관리자에게 문의하세요."
        end
        if plan.unselected_overlapping_ids.any?
          raise RedactConflict, "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요."
        end
        unless plan.range_bounds == original_plan.range_bounds
          raise RedactConflict, "다른 곳에서 전사가 변경되었습니다. 새로고침 후 다시 시도하세요."
        end

        plan
      end

      # FTS 행이 실제로 지워졌는지 확인. fts_delete 가 예외를 삼키므로(fts_indexable.rb:46-49)
      # destroy_all 이 성공해도 인덱스에 기밀 평문이 남아 있을 수 있다. 남아 있으면 raise 해
      # 트랜잭션을 롤백시킨다(→ 오디오도 원복, 사용자는 재시도 가능).
      def verify_fts_purged!(table, source_ids)
        return if source_ids.empty?

        conn = ActiveRecord::Base.connection
        placeholders = ([ "?" ] * source_ids.length).join(", ")
        rows = conn.execute(ActiveRecord::Base.sanitize_sql_array(
          [ "SELECT COUNT(*) AS c FROM #{table} WHERE source_id IN (#{placeholders})" ] + source_ids
        ))
        row = rows.to_a.first
        remaining = (row.is_a?(Hash) ? row["c"] : row&.first).to_i
        return if remaining.zero?

        raise "FTS 인덱스에서 #{remaining}건이 지워지지 않았습니다(#{table}) — 기밀 평문 잔존 위험으로 롤백합니다"
      end

      # 남은 행의 ms 를 누적 delta 만큼 당기고 sequence_number 를 1..N 으로 재번호한다.
      # FTS 콜백은 content/speaker_label/speaker_name 변경에만 걸리므로
      # (transcript.rb:3 fts_table columns) ms·seq 벌크 갱신에는 콜백이 필요 없다.
      # reorder(nil) 필수 — default_scope { order(:sequence_number) } 가 UPDATE 에 ORDER BY 를
      # 붙이면 SQLite 가 컴파일 플래그 없이 거부한다(split 과 동일 이유).
      def shift_remaining_transcripts!(plan)
        # ⚠️ delta_for(row.started_at_ms) 를 행에 그대로 쓰면 안 된다(plan 주석 §delta_for).
        # 그건 **시점 하나**의 시프트량이고, 클램프를 포기한 면제 이웃은 경계를 실제로 가로지르므로
        # started 쪽 delta 가 0 이 나온다 — 그 뒤 행들만 구간 길이만큼 당겨져 이웃이 뒤 행보다
        # 뒤에 놓이는 타임라인 붕괴가 난다. 행 단위는 shift_deltas_for(row) 가 쌍으로 준다.
        # 쌍으로 group_by 해도 벌크 UPDATE 유지 — 행마다 UPDATE 를 날리면 SQLite write lock 을
        # 오래 쥔다(이 저장소에 lock storm 실측 이력 있음).
        plan.remaining_rows.group_by { |row| plan.shift_deltas_for(row) }
            .each do |(started_delta, ended_delta), group|
          next if started_delta.zero? && ended_delta.zero?

          Transcript.where(id: group.map(&:id)).reorder(nil).update_all(
            ActiveRecord::Base.sanitize_sql_array(
              [ "started_at_ms = started_at_ms - ?, ended_at_ms = ended_at_ms - ?",
                started_delta, ended_delta ]
            )
          )
        end

        # 재번호는 행당 UPDATE 로 하지 않는다 — 3000행 회의면 2999개 UPDATE 가 하나의 트랜잭션
        # 안에서 SQLite write lock 을 오래 쥔다(이 저장소에 lock storm 실측 이력이 있다).
        # (meeting_id, sequence_number) 에 unique 제약이 없으므로(schema.rb 일반 index) 중간
        # 충돌 걱정 없이 한 번에 갱신할 수 있다. 필요한 값이 같은 행끼리 묶어 update_all 한다.
        remaining = Transcript.where(meeting_id: @meeting.id).order(:sequence_number).to_a
        remaining.each_with_index.group_by { |row, i| i + 1 - row.sequence_number }
                 .each do |shift, pairs|
          next if shift.zero?

          Transcript.where(id: pairs.map { |row, _| row.id }).reorder(nil).update_all(
            ActiveRecord::Base.sanitize_sql_array(
              [ "sequence_number = sequence_number + ?", shift ]
            )
          )
        end
      end

      # meeting_bookmarks.timestamp_ms 는 transcript 와 FK 가 없는 독립 마커라 destroy_batch 가
      # 손대지 않는다. 구간 내부는 그 순간이 사라졌으므로 삭제, 이후는 delta 만큼 당긴다.
      # 경계 규약은 delta 규칙(cut_end <= t)과 맞춘다: cut_start <= ts < cut_end 면 삭제.
      def redact_bookmarks!(plan)
        removed = 0
        @meeting.meeting_bookmarks.to_a.each do |bm|
          if plan.ranges.any? { |r| r.cover?(bm.timestamp_ms) }
            bm.destroy!
            removed += 1
          else
            delta = plan.delta_for(bm.timestamp_ms)
            bm.update_column(:timestamp_ms, bm.timestamp_ms - delta) if delta.positive?
          end
        end
        removed
      end

      # 챗 인용 마커 보정. 챗 본문 자체는 지우지 않는다(사용자 결정) — 대신 마커가 어긋난 채
      # 남으면 speakerAtMs 의 nearest 폴백에 거리 상한이 없어(citationMarkers.ts:76-85) 조용히
      # 엉뚱한 발언으로 시크한다. ChatMessage 에는 FTS·임베딩 콜백이 없어 update_column 으로 충분하다.
      def redact_chat_markers!(plan)
        changed = 0

        # 회의 스코프 — 시스템 작업이므로 for_user 를 쓰지 않는다(전 사용자 대상).
        @meeting.chat_messages.each do |msg|
          new_content, n = rewrite_meeting_markers(msg.content.to_s, plan)
          next if n.zero?

          msg.update_column(:content, new_content)
          changed += n
        end

        # 폴더·프로젝트 스코프 — 이 회의를 인용한 것만. | 구분자 변형 때문에 LIKE 는 ⟦m:<id>/
        # 접두만 거르는 1차 필터이고 실제 판정은 정규식이 한다. ESCAPE '\' 는 하우스 룰(리터럴에
        # %·_ 가 없어도 붙인다).
        ChatMessage.where(scope_type: %w[folder project])
                   .where("content LIKE ? ESCAPE '\\'", "%⟦m:#{@meeting.id}/%")
                   .each do |msg|
          new_content, n = rewrite_folder_markers(msg.content.to_s, plan)
          next if n.zero?

          msg.update_column(:content, new_content)
          changed += n
        end

        changed
      end

      def rewrite_meeting_markers(text, plan)
        n = 0
        out = text.gsub(LlmPrompts::CitationMarkers::CITATION_RE) do
          m = Regexp.last_match
          shifted = shifted_marker_time(m[1], plan)
          next m[0] if shifted.nil?

          n += 1
          shifted.empty? ? "" : "⟦t:#{shifted}/s:#{m[2]}⟧"
        end
        [ out, n ]
      end

      def rewrite_folder_markers(text, plan)
        n = 0
        out = text.gsub(LlmPrompts::CitationMarkers::FOLDER_CITATION_RE) do
          m = Regexp.last_match
          next m[0] if m[1].to_i != @meeting.id

          shifted = shifted_marker_time(m[2], plan)
          next m[0] if shifted.nil?

          n += 1
          shifted.empty? ? "" : "⟦m:#{@meeting.id}/t:#{shifted}/s:#{m[3]}⟧"
        end
        [ out, n ]
      end

      # 구간 내부 → "" (마커 제거), 구간들 이후 → delta 만큼 당긴 시간 문자열, 그 외 → nil(무변경).
      # 콜론 형태(mm:ss·hh:mm:ss)는 같은 형태로 재직렬화한다.
      def shifted_marker_time(raw_time, plan)
        ms = LlmPrompts::CitationMarkers.marker_time_to_ms(raw_time)
        return "" if plan.ranges.any? { |r| r.cover?(ms) }

        delta = plan.delta_for(ms)
        return nil if delta.zero?

        LlmPrompts::CitationMarkers.format_marker_time(ms - delta, like: raw_time)
      end
    end
  end
end

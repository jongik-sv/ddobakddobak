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
      # 절단된 회의에는 전사를 **되돌릴 수 있는** bulk_create 만 막는다. redact(재절단)·
      # destroy_batch·update_content·split 은 콘텐츠를 복원하지 않으므로 통과시킨다 —
      # 특히 redact 를 막으면 잔존 기밀 행을 마저 지울 경로가 사라진다.
      # 인가 뒤 / reject_if_locked! 앞 배치 이유는 meeting_write_guard.rb 주석 참조.
      before_action :reject_if_redacted!, only: %i[bulk_create]
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
        # 요약 잡이 applied_to_minutes: false 행을 읽는 중이라, 그 사이 행을 쪼개면
        # append 대상이 어긋난다(meeting_summarization_job.rb).
        return if reject_if_meeting_busy!("분할")

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
        return if reject_if_meeting_busy!("절단")

        result = TranscriptRedactionService.new(
          @meeting, ids: ids, expected_bounds: params[:expected_bounds]
        ).call
        return render json: result.body, status: result.status unless result.success?

        payload = result.body
        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          payload.merge(type: "transcript_redacted", client_id: params[:client_id])
        )

        render json: payload
      end

      private

      # split·redact 공용 진행 상태 가드. recording?/transcribing?/summarizing? 중이면 409로
      # 막고 true를 반환(호출부는 `return if reject_if_meeting_busy!(...)`로 액션을 종료한다).
      # 문구의 동사만 액션마다 다르다(분할/절단) — 그 외 조건·상태코드는 동일.
      def reject_if_meeting_busy!(verb)
        if @meeting.recording? || @meeting.transcribing?
          render json: { error: "녹음 또는 전사 중에는 #{verb}할 수 없습니다." }, status: :conflict
          return true
        end
        if @meeting.summarizing?
          render json: { error: "요약 중에는 #{verb}할 수 없습니다." }, status: :conflict
          return true
        end
        false
      end

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
    end
  end
end

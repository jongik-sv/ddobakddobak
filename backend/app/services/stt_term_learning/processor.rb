module SttTermLearning
  # queued run 하나를 처리한다: 후보 추출(LLM, 트랜잭션 밖) → 필터 → 등록(flush!) → items·오인식 기록.
  # 등록·기록은 한 트랜잭션이라 중간 실패 시 도메인 파일 변경까지 전부 롤백되고 run 은 failed 로 남는다.
  class Processor
    ERROR_MAX = 500

    def initialize(run)
      @run = run
    end

    # -> SttTermLearningRun
    def call
      return @run unless claim!

      begin
        extracted = CandidateExtractor.new(@run).call
        ::ActiveRecord::Base.transaction do
          apply!(extracted[:candidates])
          @run.update!(status: "done", finished_at: Time.current,
                       llm_model: extracted[:llm_model], llm_skipped_reason: extracted[:llm_skipped_reason])
        end
      rescue => e
        Rails.logger.error "[SttTermLearning::Processor] run=#{@run.id} 실패: #{e.class}: #{e.message}"
        # reload 하지 않는다 — 처리 중 run 이 지워졌어도(회의 삭제·절단) 예외 없이 0건 갱신으로 끝난다.
        now = Time.current
        ::SttTermLearningRun.where(id: @run.id)
                            .update_all(status: "failed", error: "#{e.class}: #{e.message}".truncate(ERROR_MAX),
                                        finished_at: now, updated_at: now)
      end
      @run
    end

    private

    # queued → running 을 조건부 UPDATE 로 선점한다(같은 run 이 두 번 처리되지 않게).
    def claim!
      now = Time.current
      claimed = ::SttTermLearningRun.where(id: @run.id, status: "queued")
                                    .update_all(status: "running", started_at: now, updated_at: now)
      @run.reload
      claimed == 1
    end

    def apply!(candidates)
      meeting = @run.meeting
      filter = CandidateFilter.new(meeting: meeting, transcript_text: @run.transcript_text,
                                   min_confidence: AppSettings.stt_term_learning["min_confidence"])
      registrar = Registrar.new(meeting)

      rows = candidates.map do |c|
        verdict, reason = filter.verdict_for(c)
        result = verdict ? { verdict: verdict, reason: reason, domain_file: nil, level: nil, change: nil } : registrar.register(c)
        [ c, result ]
      end
      # flush! 는 결과 Hash 를 그 자리에서 강등할 수 있다(changed_during_run·file_full) → 기록은 그 뒤에.
      registrar.flush!

      rows.each do |c, result|
        misrecognition = ::SttMisrecognition.record_verdict!(meeting: meeting, wrong: c.wrong, correct: c.correct,
                                                             verdict: result[:verdict])
        level = result[:level]
        @run.items.create!(
          wrong: c.wrong, correct: c.correct, wrong_key: c.wrong_key, correct_key: c.correct_key,
          source: c.source, category: c.category, definition: c.definition, confidence: c.confidence,
          verdict: result[:verdict], reason: result[:reason],
          domain_file_id: result[:domain_file]&.id,
          level_owner_type: level&.type, level_owner_id: level&.owner&.id,
          change: result[:change]&.to_json,
          misrecognition: misrecognition
        )
      end
    end
  end
end

module SttTermLearning
  # 관리자 명시 등록. 필터(§5.4)를 건너뛰고 Registrar(§5.5 레벨 체인 중복 방지)로 바로 등록한다.
  #   call(item):           건너뛴 학습 item 하나를 그 회의 레벨 체인에 등록. item 의 verdict·change·파일·레벨을 갱신해
  #                         회의 단위 되돌리기(Reverter) 대상이 된다. 오인식 기록은 confirmed(excluded 였어도).
  #                         done run 의 항목만. change 에 "manual_at"(iso8601(6))을 남겨 Reverter 가 쓴 순서를 안다.
  #   register_pair!(mis):  오인식 기록 쌍 하나를 등록(⑤ 화면에서 confirmed 로 바꿀 때). last_meeting 이 있고 같은
  #                         프로젝트면 그 회의 체인, 없으면 프로젝트 → 전역 체인(LevelChain.upward_from(프로젝트)와 같음)에서
  #                         찾아 병합하고 못 찾으면 프로젝트 자동 파일에 새 줄. item·change 를 남기지 않는다(되돌리기 대상 아님).
  # 등록하지 못하면(file_full·format_chars·no_level 등) Error 를 내고 전부 롤백한다.
  module ManualRegistration
    class Error < StandardError; end

    REGISTRABLE_VERDICTS = %w[skipped_excluded skipped_not_in_transcript skipped_conflict skipped_low_confidence].freeze
    MANUAL_REASON = "관리자 수동 등록".freeze

    # Registrar 가 회의에서 읽는 것은 folder·project·creator 뿐이다. 회의 없이 프로젝트 레벨부터 올라가는 체인용.
    ProjectScope = Struct.new(:project, :creator) do
      def folder = nil
    end

    module_function

    # -> SttTermLearningItem (갱신된 item)
    def call(item)
      ::ActiveRecord::Base.transaction do
        item.reload
        run = ::SttTermLearningRun.find(item.run_id)
        raise Error, "되돌린 실행의 항목은 등록할 수 없습니다" if run.status == "reverted"
        raise Error, "완료(done)된 실행의 항목만 등록할 수 있습니다 (현재: #{run.status})" unless run.status == "done"
        unless REGISTRABLE_VERDICTS.include?(item.verdict)
          raise Error, "수동 등록할 수 없는 항목입니다 (#{item.verdict})"
        end

        meeting = run.meeting
        candidate = Candidate.new(wrong: item.wrong, correct: item.correct, category: item.category,
                                  definition: item.definition, confidence: item.confidence, source: item.source)
        r = register!(Registrar.new(meeting), candidate)
        mis = confirm_for_item!(item, meeting)
        item.update!(verdict: r[:verdict], reason: MANUAL_REASON, change: r[:change]&.merge("manual_at" => Time.current.iso8601(6))&.to_json,
                     domain_file_id: r[:domain_file]&.id,
                     level_owner_type: r[:level]&.type, level_owner_id: r[:level]&.owner&.id,
                     misrecognition_id: mis&.id, revert_result: nil)
      end
      item
    rescue ::ActiveRecord::ActiveRecordError => e
      raise Error, e.message
    end

    # -> Registrar 결과 Hash { verdict:, reason:, domain_file:, level:, change: }
    def register_pair!(misrecognition, actor:)
      ::ActiveRecord::Base.transaction do
        misrecognition.reload
        meeting = misrecognition.last_meeting
        scope = if meeting && meeting.project_id == misrecognition.project_id
          meeting
        else
          ProjectScope.new(misrecognition.project, actor)
        end
        candidate = Candidate.new(wrong: misrecognition.wrong, correct: misrecognition.correct,
                                  category: nil, definition: nil, confidence: nil, source: "feedback")
        r = register!(Registrar.new(scope, fallback_creator: actor || scope.creator), candidate)
        misrecognition.update!(status: "confirmed")
        r
      end
    rescue ::ActiveRecord::ActiveRecordError => e
      raise Error, e.message
    end

    def register!(registrar, candidate)
      r = registrar.register(candidate)
      registrar.flush! # flush! 가 verdict 를 file_full·changed_during_run 으로 바꿀 수 있어 그 뒤에 판정한다.
      unless ::SttTermLearningItem::APPLIED_VERDICTS.include?(r[:verdict])
        raise Error, [ "등록하지 못했습니다", r[:verdict], r[:reason] ].compact.join(": ")
      end
      r
    end

    # 이미 연결된 기록이면 횟수는 그대로 두고 confirmed 로만(이 item 몫은 학습 때 셌다).
    # 연결이 없으면 record! 로 이 item 몫 1회를 세고 연결한다. record! 는 excluded 를 유지하므로 명시적으로 confirmed.
    def confirm_for_item!(item, meeting)
      rec = item.misrecognition_id && ::SttMisrecognition.find_by(id: item.misrecognition_id)
      rec ||= ::SttMisrecognition.record!(project_id: meeting.project_id, wrong: item.wrong, correct: item.correct,
                                          status: "confirmed", meeting: meeting)
      return nil unless rec
      rec.update!(status: "confirmed") unless rec.status == "confirmed"
      rec
    end
  end
end

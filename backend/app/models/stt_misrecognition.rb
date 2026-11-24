class SttMisrecognition < ApplicationRecord
  STATUSES = %w[confirmed undecided excluded].freeze

  # 학습 item verdict → 오인식 기록 상태. :hit_only 는 상태를 건드리지 않고 횟수만 센다.
  # skipped_invalid·skipped_not_in_transcript·skipped_no_level 은 기록하지 않는다(문장 다듬기 오염 방지, 계획 G2).
  STATUS_BY_VERDICT = SttTermLearningItem::APPLIED_VERDICTS.index_with("confirmed").merge(
    "skipped_conflict" => "undecided",
    "skipped_low_confidence" => "undecided",
    "skipped_excluded" => :hit_only
  ).freeze

  belongs_to :project
  belongs_to :first_meeting, class_name: "Meeting", optional: true
  belongs_to :last_meeting, class_name: "Meeting", optional: true

  validates :status, inclusion: { in: STATUSES }

  scope :confirmed, -> { where(status: "confirmed") }
  scope :undecided, -> { where(status: "undecided") }
  scope :excluded, -> { where(status: "excluded") }

  class << self
    # verdict → "confirmed" | "undecided" | :hit_only | nil(기록 안 함)
    def status_for_verdict(verdict)
      STATUS_BY_VERDICT[verdict.to_s]
    end

    # 학습 item 하나의 오인식 기록. 기록 대상이 아니거나 회의에 project 가 없으면 nil.
    def record_verdict!(meeting:, wrong:, correct:, verdict:)
      status = status_for_verdict(verdict)
      return nil if status.nil?
      record!(project_id: meeting&.project_id, wrong: wrong, correct: correct,
              status: status == :hit_only ? nil : status, meeting: meeting)
    end

    # (project, wrong_key, correct_key) upsert 후 hit_count += 1, last_seen_at·last_meeting 갱신, first_meeting ||=.
    # 상태 규칙: 기존 excluded 는 유지, "confirmed" 는 덮어씀, "undecided" 는 confirmed 를 강등하지 않음,
    # nil 은 상태 유지(새로 만들면 undecided). project_id 가 nil 이면 기록하지 않고 nil.
    def record!(project_id:, wrong:, correct:, status:, meeting:)
      return nil if project_id.nil?

      attempts = 0
      begin
        attempts += 1
        transaction(requires_new: true) do
          rec = find_or_initialize_by(project_id: project_id,
                                      wrong_key: DomainFile.normalize_key(wrong),
                                      correct_key: DomainFile.normalize_key(correct))
          if rec.new_record?
            rec.wrong = wrong.to_s.strip
            rec.correct = correct.to_s.strip
            rec.status = "undecided"
            rec.hit_count = 0
          end
          rec.status = next_status(rec.status, status)
          rec.hit_count = rec.hit_count.to_i + 1
          rec.last_seen_at = Time.current
          if meeting&.id
            rec.last_meeting_id = meeting.id
            rec.first_meeting_id ||= meeting.id
          end
          rec.save!
          rec
        end
      rescue ActiveRecord::RecordNotUnique
        retry if attempts < 2
        raise
      end
    end

    private

    def next_status(current, requested)
      return current if current == "excluded"
      case requested
      when "confirmed", "excluded" then requested
      when "undecided" then current == "confirmed" ? "confirmed" : "undecided"
      else current
      end
    end
  end
end

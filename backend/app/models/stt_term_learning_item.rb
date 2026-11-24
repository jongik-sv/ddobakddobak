class SttTermLearningItem < ApplicationRecord
  SOURCES = %w[llm_diff feedback].freeze
  VERDICTS = %w[
    registered merged_existing already_known
    skipped_excluded skipped_invalid skipped_not_in_transcript skipped_conflict
    skipped_low_confidence skipped_no_level
  ].freeze
  APPLIED_VERDICTS = %w[registered merged_existing already_known].freeze

  belongs_to :run, class_name: "SttTermLearningRun"
  belongs_to :domain_file, optional: true
  belongs_to :misrecognition, class_name: "SttMisrecognition", optional: true

  # 적용된(등록·병합·이미 있음) 항목 중 되돌려지지 않은 run 의 것.
  scope :applied_live, -> {
    where(verdict: APPLIED_VERDICTS).joins(:run).where.not(stt_term_learning_runs: { status: "reverted" })
  }

  validates :source, inclusion: { in: SOURCES }
  validates :verdict, inclusion: { in: VERDICTS }

  def change_data
    return {} if change.blank?
    parsed = JSON.parse(change)
    parsed.is_a?(Hash) ? parsed : {}
  rescue JSON::ParserError
    {}
  end
end

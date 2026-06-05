class MeetingContact < ApplicationRecord
  belongs_to :meeting
  belongs_to :source_attachment, class_name: "MeetingAttachment", optional: true
  belongs_to :creator, class_name: "User", foreign_key: "created_by_id"

  # 빈 명함(인식 실패)도 raw_text 보존을 위해 name presence를 강제하지 않는다.
  def display_label
    [ name.presence, company.presence ].compact.join(" / ").presence || "(미인식 명함)"
  end
end

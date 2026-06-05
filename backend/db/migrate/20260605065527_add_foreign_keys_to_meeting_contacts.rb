class AddForeignKeysToMeetingContacts < ActiveRecord::Migration[8.0]
  def change
    # 명함 원본 이미지 삭제 시 연락처는 보존(OCR 1회 영속 원칙) → nullify
    add_foreign_key :meeting_contacts, :meeting_attachments,
                    column: :source_attachment_id, on_delete: :nullify
    add_foreign_key :meeting_contacts, :users, column: :created_by_id
  end
end

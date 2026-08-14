class AddStakeholderToMeetingAttachmentsCategoryCheck < ActiveRecord::Migration[8.0]
  def up
    remove_check_constraint :meeting_attachments, name: "chk_meeting_attachments_category"
    add_check_constraint :meeting_attachments,
                          "category IN ('agenda','reference','minutes','business_card','stakeholder')",
                          name: "chk_meeting_attachments_category"
  end

  def down
    remove_check_constraint :meeting_attachments, name: "chk_meeting_attachments_category"
    add_check_constraint :meeting_attachments, "category IN ('agenda','reference','minutes','business_card')",
                          name: "chk_meeting_attachments_category"
  end
end

class AddDflowMeetingFieldsToMeetings < ActiveRecord::Migration[8.1]
  def change
    # D'Flow 회의 연결(SSOT는 dflow_meeting_id) — 스펙: dflow-meeting-select-design.md §1.
    add_column :meetings, :dflow_meeting_id, :string       # D'Flow 회의 uuid (nullable)
    add_column :meetings, :dflow_meeting_title, :string    # 표시 스냅샷(낡을 수 있음, 수용)
    add_column :meetings, :dflow_project_name, :string     # 표시 스냅샷(낡을 수 있음, 수용)
  end
end

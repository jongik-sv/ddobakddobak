class AddBriefSummaryToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :brief_summary, :string
  end
end

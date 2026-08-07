class AddSummaryCustomPromptToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :summary_custom_prompt, :text
  end
end

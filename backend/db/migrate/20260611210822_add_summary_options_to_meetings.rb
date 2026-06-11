class AddSummaryOptionsToMeetings < ActiveRecord::Migration[8.0]
  def change
    add_column :meetings, :summary_verbosity, :string, default: "standard", null: false
    add_column :meetings, :summary_restructure, :boolean, default: true, null: false
  end
end

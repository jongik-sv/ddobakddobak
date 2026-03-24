class AddLastRefinedSeqToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :last_refined_seq, :integer, default: 0, null: false
  end
end

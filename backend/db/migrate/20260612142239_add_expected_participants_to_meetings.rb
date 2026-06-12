class AddExpectedParticipantsToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :expected_participants, :integer
  end
end

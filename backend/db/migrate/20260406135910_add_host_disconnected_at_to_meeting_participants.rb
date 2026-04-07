class AddHostDisconnectedAtToMeetingParticipants < ActiveRecord::Migration[8.1]
  def change
    add_column :meeting_participants, :host_disconnected_at, :datetime
  end
end

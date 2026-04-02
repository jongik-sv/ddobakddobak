class CreateMeetingParticipants < ActiveRecord::Migration[8.1]
  def change
    create_table :meeting_participants do |t|
      t.references :meeting, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.string :role, null: false, default: "viewer"
      t.datetime :joined_at, null: false
      t.datetime :left_at
      t.timestamps
    end

    add_index :meeting_participants, [:meeting_id, :user_id, :left_at],
              name: "idx_participants_meeting_user_active"
    add_index :meeting_participants, [:meeting_id, :role],
              name: "idx_participants_meeting_role"
  end
end

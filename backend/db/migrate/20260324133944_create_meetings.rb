class CreateMeetings < ActiveRecord::Migration[8.1]
  def change
    create_table :meetings do |t|
      t.string   :title,          null: false
      t.integer  :team_id,        null: false
      t.integer  :created_by_id,  null: false
      t.string   :status,         null: false, default: "pending"
      t.datetime :started_at
      t.datetime :ended_at
      t.string   :audio_file_path

      t.timestamps null: false
    end

    add_index :meetings, :team_id
    add_index :meetings, :created_by_id
    add_index :meetings, [ :team_id, :status ]
  end
end

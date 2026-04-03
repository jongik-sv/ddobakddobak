class CreateMeetingBookmarks < ActiveRecord::Migration[8.0]
  def change
    create_table :meeting_bookmarks do |t|
      t.references :meeting, null: false, foreign_key: true
      t.integer :timestamp_ms, null: false
      t.string :label

      t.timestamps
    end

    add_index :meeting_bookmarks, [:meeting_id, :timestamp_ms]
  end
end

class CreateSummaries < ActiveRecord::Migration[8.1]
  def change
    create_table :summaries do |t|
      t.integer  :meeting_id,         null: false
      t.text     :key_points
      t.text     :decisions
      t.text     :discussion_details
      t.string   :summary_type,       null: false, default: "final"
      t.datetime :generated_at,       null: false

      t.timestamps null: false
    end

    add_index :summaries, :meeting_id
  end
end

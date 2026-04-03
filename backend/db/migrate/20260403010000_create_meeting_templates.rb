class CreateMeetingTemplates < ActiveRecord::Migration[8.1]
  def change
    create_table :meeting_templates do |t|
      t.references :user, null: false, foreign_key: true
      t.string :name, null: false
      t.string :meeting_type
      t.references :folder, null: true, foreign_key: true
      t.json :settings_json, default: {}

      t.timestamps
    end
  end
end

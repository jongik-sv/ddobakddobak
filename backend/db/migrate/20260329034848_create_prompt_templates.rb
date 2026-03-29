class CreatePromptTemplates < ActiveRecord::Migration[8.1]
  def change
    create_table :prompt_templates do |t|
      t.string  :meeting_type, null: false
      t.string  :label, null: false
      t.text    :sections_prompt, null: false
      t.boolean :is_default, default: false, null: false
      t.timestamps
    end
    add_index :prompt_templates, :meeting_type, unique: true
  end
end

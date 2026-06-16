class AddProjectFieldsAndInvites < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :description, :text
    add_column :projects, :icon_type, :string     # 'lucide' | 'emoji' | 'image'
    add_column :projects, :icon_value, :string     # 아이콘명 / 이모지문자 / 파일경로
    add_column :projects, :color, :string           # hex 배경색
    add_column :projects, :personal, :boolean, null: false, default: false
    add_index :projects, :personal

    create_table :project_invites do |t|
      t.references :project, null: false, foreign_key: { on_delete: :cascade }
      t.string :code, null: false
      t.integer :created_by_id, null: false
      t.datetime :expires_at
      t.integer :max_uses
      t.integer :use_count, null: false, default: 0
      t.timestamps
    end
    add_index :project_invites, :code, unique: true
  end
end

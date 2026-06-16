class CreateChatMessages < ActiveRecord::Migration[8.1]
  def change
    create_table :chat_messages do |t|
      t.references :meeting, null: false, foreign_key: { on_delete: :cascade }
      t.references :user, null: false, foreign_key: true
      t.string :role, null: false
      t.text :content, null: false, default: ""
      t.string :status, null: false, default: "complete"
      t.text :error_message
      t.timestamps
    end
    add_index :chat_messages, [:meeting_id, :user_id, :created_at]
  end
end

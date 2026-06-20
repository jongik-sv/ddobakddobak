class AddModelNameToChatMessages < ActiveRecord::Migration[8.0]
  def change
    add_column :chat_messages, :model_name, :string
  end
end

class AddSuggestionsJsonToChatMessages < ActiveRecord::Migration[8.1]
  def change
    add_column :chat_messages, :suggestions_json, :text, default: "[]", null: false
  end
end

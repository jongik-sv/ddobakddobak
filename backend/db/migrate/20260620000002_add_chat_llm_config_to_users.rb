class AddChatLlmConfigToUsers < ActiveRecord::Migration[8.0]
  def change
    add_column :users, :chat_llm_provider, :string
    add_column :users, :chat_llm_api_key, :text
    add_column :users, :chat_llm_base_url, :string
  end
end

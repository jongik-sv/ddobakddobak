class AddLlmProfileRefsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :llm_profile_id, :bigint
    add_column :users, :chat_llm_profile_id, :bigint
    add_index :users, :llm_profile_id
    add_index :users, :chat_llm_profile_id
  end
end

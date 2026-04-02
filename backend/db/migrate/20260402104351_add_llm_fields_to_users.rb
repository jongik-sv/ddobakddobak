class AddLlmFieldsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :llm_provider, :string
    add_column :users, :llm_api_key, :text
    add_column :users, :llm_model, :string
    add_column :users, :llm_base_url, :string
  end
end

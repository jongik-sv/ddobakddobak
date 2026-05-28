class AddLanguageSettingsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :language_mode, :string, default: "single"
    add_column :users, :selected_languages, :string
  end
end

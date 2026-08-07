class AddPrevCondensedCacheToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :prev_condensed_notes, :text
    add_column :meetings, :prev_condensed_digest, :string
  end
end

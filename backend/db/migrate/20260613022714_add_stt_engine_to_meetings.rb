class AddSttEngineToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :stt_engine, :string
  end
end

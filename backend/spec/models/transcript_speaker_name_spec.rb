require "rails_helper"

RSpec.describe Transcript, type: :model do
  describe "speaker_name 컬럼" do
    it "nullable string 컬럼이 존재한다" do
      expect(Transcript.column_names).to include("speaker_name")
      t = create(:transcript, speaker_name: nil)
      expect(t).to be_valid
    end

    it "speaker_name을 저장/조회할 수 있다" do
      t = create(:transcript, speaker_name: "앨리스")
      expect(t.reload.speaker_name).to eq("앨리스")
    end
  end
end

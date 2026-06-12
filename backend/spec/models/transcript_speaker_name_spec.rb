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

  describe ".to_sidecar_payload" do
    it "speaker_name이 있으면 speaker로 사용, 없으면 speaker_label" do
      named = create(:transcript, speaker_label: "화자 1", speaker_name: "김철수")
      unnamed = create(:transcript, speaker_label: "화자 2", speaker_name: nil)

      payload = Transcript.to_sidecar_payload([named, unnamed])

      expect(payload[0][:speaker]).to eq("김철수")
      expect(payload[1][:speaker]).to eq("화자 2")
    end
  end
end

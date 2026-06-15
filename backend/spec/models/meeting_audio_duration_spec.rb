require "rails_helper"

# audio_duration_ms 컬럼 캐시 (#1 perf: serializer 매 show ffprobe 제거)
RSpec.describe Meeting, type: :model do
  let(:user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user) }

  describe "#measure_audio_duration_ms" do
    it "returns 0 when audio_file_path is blank" do
      expect(meeting.measure_audio_duration_ms).to eq(0)
    end

    it "returns 0 when the referenced file does not exist" do
      meeting.update_column(:audio_file_path, "/tmp/does-not-exist-#{SecureRandom.hex}.mp3")
      expect(meeting.measure_audio_duration_ms).to eq(0)
    end
  end

  describe "#refresh_audio_duration!" do
    it "persists the measured duration into the column" do
      allow(meeting).to receive(:measure_audio_duration_ms).and_return(42_000)
      meeting.refresh_audio_duration!
      expect(meeting.reload.audio_duration_ms).to eq(42_000)
    end

    it "stores 0 when there is no audio" do
      meeting.refresh_audio_duration!
      expect(meeting.reload.audio_duration_ms).to eq(0)
    end

    it "re-measures even when audio_file_path string is unchanged (merge grows file)" do
      allow(meeting).to receive(:measure_audio_duration_ms).and_return(1_000, 2_000)
      meeting.refresh_audio_duration!
      expect(meeting.reload.audio_duration_ms).to eq(1_000)
      meeting.refresh_audio_duration!
      expect(meeting.reload.audio_duration_ms).to eq(2_000)
    end
  end
end

require "rails_helper"

RSpec.describe FileTranscriptionJob, type: :job do
  let(:creator) { create(:user, language_mode: "multi", selected_languages: "ko,en") }
  let(:meeting) { create(:meeting, creator: creator, status: "transcribing") }

  let(:sidecar) { instance_double(SidecarClient) }

  before do
    allow_any_instance_of(described_class).to receive(:convert_to_pcm).and_return("/tmp/x_pcm.raw")
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:delete)
    allow(SidecarClient).to receive(:new).and_return(sidecar)
    allow(sidecar).to receive(:transcribe_file).and_return({ "segments" => [] })
    allow_any_instance_of(described_class).to receive(:generate_summary)
    allow(MeetingFinalizerService).to receive(:new).and_return(instance_double(MeetingFinalizerService, call: nil))
  end

  it "passes the meeting creator's language config to the sidecar, not ENV" do
    ENV["SELECTED_LANGUAGES"] = "ja"
    ENV["LANGUAGE_MODE"] = "single"

    expect(sidecar).to receive(:transcribe_file).with(
      anything,
      hash_including(languages: %w[ko en], mode: "multi")
    ).and_return({ "segments" => [] })

    described_class.perform_now(meeting.id)
  ensure
    ENV.delete("SELECTED_LANGUAGES")
    ENV.delete("LANGUAGE_MODE")
  end
end

require "rails_helper"

RSpec.describe AudioUploadJob, type: :job do
  let(:meeting) { create(:meeting) }
  let(:audio_dir) { Rails.root.join("tmp", "test_audio_#{SecureRandom.hex(4)}") }

  before { FileUtils.mkdir_p(audio_dir) }
  after  { FileUtils.rm_rf(audio_dir) }

  # 최소한의 유효한 16-bit mono WAV 파일 생성 (ffmpeg이 디코딩 가능)
  def write_wav(path, seconds: 0.2, rate: 16_000)
    samples = (rate * seconds).to_i
    data = ("\x00\x00".b * samples)
    File.open(path, "wb") do |f|
      f.write("RIFF")
      f.write([ 36 + data.bytesize ].pack("V"))
      f.write("WAVE")
      f.write("fmt ")
      f.write([ 16 ].pack("V"))
      f.write([ 1 ].pack("v"))       # PCM
      f.write([ 1 ].pack("v"))       # mono
      f.write([ rate ].pack("V"))
      f.write([ rate * 2 ].pack("V")) # byte rate
      f.write([ 2 ].pack("v"))       # block align
      f.write([ 16 ].pack("v"))      # bits per sample
      f.write("data")
      f.write([ data.bytesize ].pack("V"))
      f.write(data)
    end
  end

  it "WAV을 mp3로 변환하고 audio_file_path를 .mp3로 갱신하며 원본을 삭제한다" do
    wav = File.join(audio_dir, "#{meeting.id}.wav")
    write_wav(wav)
    meeting.update!(audio_file_path: wav)

    described_class.perform_now(meeting_id: meeting.id)

    meeting.reload
    expect(File.extname(meeting.audio_file_path)).to eq(".mp3")
    expect(File.exist?(meeting.audio_file_path)).to be true
    expect(File.size(meeting.audio_file_path)).to be > 0
    expect(File.exist?(wav)).to be false
  end

  it "이미 mp3면 변환하지 않고 경로를 유지한다" do
    mp3 = File.join(audio_dir, "#{meeting.id}.mp3")
    File.binwrite(mp3, "id3dummy")
    meeting.update!(audio_file_path: mp3)

    described_class.perform_now(meeting_id: meeting.id)

    meeting.reload
    expect(meeting.audio_file_path).to eq(mp3)
    expect(File.exist?(mp3)).to be true
  end

  it "오디오 파일이 없으면 아무 일도 하지 않는다" do
    meeting.update!(audio_file_path: File.join(audio_dir, "missing.wav"))
    expect { described_class.perform_now(meeting_id: meeting.id) }.not_to raise_error
  end
end

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

  it "최종 mp3 경로에 직접 쓰지 않는다 — 검증 통과 전에는 tmp 에만 존재한다" do
    # 최종 파일명으로 먼저 쓰면 identity 검사 전에 절단 전(기밀) 오디오가 정식 이름으로 디스크에
    # 올라가고, 그 사이 프로세스가 죽으면 검사가 영영 안 돌아 기밀 mp3 가 남는다.
    wav = File.join(audio_dir, "#{meeting.id}.wav")
    write_wav(wav)
    meeting.update!(audio_file_path: wav)
    final_mp3 = File.join(audio_dir, "#{meeting.id}.mp3")

    job = described_class.new
    seen_final = nil
    allow(job).to receive(:transcode_to_mp3).and_wrap_original do |orig, src, dest|
      result = orig.call(src, dest)
      # 인코딩 직후(= identity 검사 직전) 시점에 최종 경로가 아직 비어 있어야 한다.
      seen_final = File.exist?(final_mp3)
      expect(dest).to end_with(".upload-tmp")
      result
    end

    job.perform(meeting_id: meeting.id)

    expect(seen_final).to be false
    expect(File.exist?(final_mp3)).to be true          # 검증 통과 후 mv 됨
    expect(Dir.glob(File.join(audio_dir, "*.upload-tmp"))).to be_empty
  end

  it "변환 중 소스 오디오가 교체되면 결과를 버리고 audio_file_path를 바꾸지 않는다 (절단본 클로버 거부)" do
    # 기밀 구간 절단이 in-flight AudioUploadJob 과 경합하는 상황. ffmpeg 은 열린 fd(옛 inode)를
    # 계속 읽으므로 결과물은 "절단 전" 오디오다 — 그대로 set_audio_file! + cleanup_original 하면
    # 절단한 webm 을 지우고 기밀을 복원한다. 진입 가드로는 못 막고, 쓰는 쪽이 거부해야 한다.
    wav = File.join(audio_dir, "#{meeting.id}.wav")
    write_wav(wav)
    meeting.update!(audio_file_path: wav)

    job = described_class.new
    allow(job).to receive(:transcode_to_mp3).and_wrap_original do |orig, src, dest|
      result = orig.call(src, dest)
      # 절단이 같은 경로를 새 파일로 교체한 상황 재현(같은 디렉토리 mv = rename = 새 inode)
      replacement = "#{src}.redacted"
      write_wav(replacement, seconds: 0.1)
      FileUtils.mv(replacement, src)
      result
    end

    job.perform(meeting_id: meeting.id)

    meeting.reload
    expect(meeting.audio_file_path).to eq(wav)
    expect(File.exist?(wav)).to be true
    expect(File.exist?(File.join(audio_dir, "#{meeting.id}.mp3"))).to be false
    # tmp 도 남기지 않는다 — 그 안에 절단 전(기밀) 오디오가 들어 있다.
    expect(Dir.glob(File.join(audio_dir, "*.upload-tmp"))).to be_empty
  end

  describe ".job_meeting_id" do
    # 순수 파싱. ActiveJob 이 perform(meeting_id:) 를 어떻게 직렬화하는지에 대한 계약을 고정한다.
    # SolidQueue::Job 으로 instance_double 을 만들 수 없어(test DB 에 solid_queue_jobs 테이블이
    # 없어 검증 시 StatementInvalid) 비검증 double 로 arguments 만 흉내낸다.
    it "kwargs 직렬화에서 meeting_id 를 뽑는다" do
      job = double("SolidQueue::Job", arguments: {
        "job_class" => "AudioUploadJob",
        "arguments" => [ { "meeting_id" => 42, "_aj_symbol_keys" => [ "meeting_id" ] } ]
      })
      expect(described_class.job_meeting_id(job)).to eq(42)
    end

    it "형태가 다르면 nil (가드가 조용히 오탐하지 않게)" do
      expect(described_class.job_meeting_id(double("SolidQueue::Job", arguments: []))).to be_nil
      expect(described_class.job_meeting_id(double("SolidQueue::Job", arguments: { "arguments" => [ 7 ] }))).to be_nil
    end
  end

  describe ".in_flight_for?" do
    # 체인 스텁은 실제 구현과 같은 단계 수여야 한다 — where(...).left_joins(...).where(...).to_a.
    # (where.missing 은 WhereChain 메서드라 verified double 로 재현할 수 없어 구현에서 뺐다.)
    # SolidQueue::Job 자체는 partial double 로도 못 쓴다 — verify_partial_doubles 가 respond_to?
    # 를 부르는 순간 없는 solid_queue_jobs 테이블을 읽으려다 StatementInvalid 가 난다. 그래서
    # stub_const 로 클래스 상수를 통째로 갈아끼운다. relation 은 그대로 instance_double 이라
    # left_joins/where/to_a 가 ActiveRecord::Relation 에 실제로 있는지는 계속 검증된다.
    # ⚠️ 인자별로 분기시킨다. `allow(relation).to receive(:where).and_return(relation)` 처럼
    # 인자와 무관하게 자기를 돌려주면 `finished_at: nil`(미완료)·failed_execution 배제 조건이
    # 전혀 반증되지 않는다 — 구현에서 그 조건들을 통째로 지워도 스펙이 green 이라, 예제 이름의
    # "미완료"는 검증되지 않은 주장이 된다. 인자를 고정하면 조건이 빠질 때 스텁이 안 맞아 터진다.
    def stub_queue(jobs)
      relation = instance_double(ActiveRecord::Relation)
      allow(relation).to receive(:left_joins).with(:failed_execution).and_return(relation)
      allow(relation).to receive(:where)
        .with(solid_queue_failed_executions: { id: nil }).and_return(relation)
      allow(relation).to receive(:to_a).and_return(jobs)
      queue = double("SolidQueue::Job")
      allow(queue).to receive(:where)
        .with(class_name: "AudioUploadJob", finished_at: nil).and_return(relation)
      stub_const("SolidQueue::Job", queue)
    end

    def queued_job(meeting_id)
      double("SolidQueue::Job", arguments: {
        "job_class" => "AudioUploadJob",
        "arguments" => [ { "meeting_id" => meeting_id, "_aj_symbol_keys" => [ "meeting_id" ] } ]
      })
    end

    it "같은 회의의 미완료 잡이 있으면 true" do
      stub_queue([ queued_job(meeting.id) ])
      expect(described_class.in_flight_for?(meeting.id)).to be true
    end

    it "다른 회의의 잡만 있으면 false (남의 잡으로 409 를 내지 않는다)" do
      stub_queue([ queued_job(meeting.id + 1) ])
      expect(described_class.in_flight_for?(meeting.id)).to be false
    end
  end
end

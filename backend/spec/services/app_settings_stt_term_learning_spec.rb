require "rails_helper"
require "tmpdir"

RSpec.describe AppSettings, "stt_term_learning", stt_settings_io: true do
  let(:tmp_dir) { Dir.mktmpdir("stt-learn-settings") }
  let(:tmp_path) { File.join(tmp_dir, "settings.yaml") }

  before { stub_const("AppSettings::SETTINGS_PATH", tmp_path) }
  after { FileUtils.remove_entry(tmp_dir) if File.exist?(tmp_dir) }

  it "키가 없으면 기본값" do
    expect(AppSettings.stt_term_learning({})).to eq("enabled" => true, "idle_minutes" => 30, "min_confidence" => 0.6)
  end

  it "범위를 벗어난 값은 클램프" do
    cfg = { "stt_term_learning" => { "enabled" => false, "idle_minutes" => 1, "min_confidence" => 3 } }
    expect(AppSettings.stt_term_learning(cfg)).to eq("enabled" => false, "idle_minutes" => 5, "min_confidence" => 1.0)
  end

  it "상한도 클램프하고 잘못된 값은 기본값" do
    cfg = { "stt_term_learning" => { "idle_minutes" => 99_999, "min_confidence" => "abc" } }
    expect(AppSettings.stt_term_learning(cfg)).to include("idle_minutes" => 1440, "min_confidence" => 0.6)
  end

  it "save_stt_term_learning! 은 다른 키를 보존하고 병합 저장" do
    File.write(tmp_path, { "whiteboard" => { "web_mode" => "copy" } }.to_yaml)
    AppSettings.save_stt_term_learning!("idle_minutes" => 45)
    expect(YAML.safe_load(File.read(tmp_path))).to include("whiteboard" => { "web_mode" => "copy" },
      "stt_term_learning" => hash_including("idle_minutes" => 45))
  end
end

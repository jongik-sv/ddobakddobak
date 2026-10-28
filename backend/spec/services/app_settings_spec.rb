require "rails_helper"

RSpec.describe AppSettings do
  let(:yaml) do
    <<~YAML
      diarization:
        enabled: true
        similarity_threshold: 0.5
        merge_threshold: 0.62
        max_embeddings_per_speaker: 12
    YAML
  end

  it "settings.yaml의 diarization 블록을 sidecar diarization_config로 변환한다" do
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:read).and_return(yaml)
    config = described_class.diarization_config
    expect(config).to eq(
      "enable" => true,
      "ahc_threshold" => 0.3,
      "clustering_threshold" => 0.6,
      "similarity_threshold" => 0.5,
      "merge_threshold" => 0.62,
      "max_embeddings_per_speaker" => 12
    )
  end

  it "파일이 없으면 기본값(비활성)을 반환한다" do
    allow(File).to receive(:exist?).and_return(false)
    expect(described_class.diarization_config["enable"]).to eq(false)
  end

  it "clustering_threshold 기본값 0.6을 포함한다" do
    allow(File).to receive(:exist?).and_return(false)
    expect(described_class.diarization_config["clustering_threshold"]).to eq(0.6)
  end

  it "settings.yaml에 clustering_threshold가 있으면 그 값을 반환한다" do
    yaml_with_threshold = <<~YAML
      diarization:
        enabled: true
        clustering_threshold: 0.55
    YAML
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:read).and_return(yaml_with_threshold)
    expect(described_class.diarization_config["clustering_threshold"]).to eq(0.55)
  end

  describe ".chat_llm_env" do
    it "llm.chat 독립 설정을 CHAT_LLM_* ENV 페어로 변환한다 (base_url 빈값은 생략)" do
      llm = {
        "chat" => {
          "provider" => "anthropic",
          "model" => "claude-haiku-4-5",
          "auth_token" => "x",
          "base_url" => ""
        }
      }
      expect(described_class.chat_llm_env(llm)).to eq(
        "CHAT_LLM_PROVIDER" => "anthropic",
        "CHAT_LLM_AUTH_TOKEN" => "x",
        "CHAT_LLM_MODEL" => "claude-haiku-4-5"
      )
    end

    it "base_url이 있으면 CHAT_LLM_BASE_URL도 포함한다" do
      llm = { "chat" => { "provider" => "anthropic", "model" => "m", "auth_token" => "x", "base_url" => "https://api.z.ai/api/anthropic" } }
      expect(described_class.chat_llm_env(llm)["CHAT_LLM_BASE_URL"]).to eq("https://api.z.ai/api/anthropic")
    end

    it "chat 독립 설정이 없고 레거시 chat_model만 있으면 CHAT_LLM_MODEL만 반환한다" do
      llm = { "chat_model" => "sonnet" }
      expect(described_class.chat_llm_env(llm)).to eq("CHAT_LLM_MODEL" => "sonnet")
    end

    it "chat provider도 chat_model도 없으면 빈 해시를 반환한다" do
      expect(described_class.chat_llm_env({})).to eq({})
      expect(described_class.chat_llm_env(nil)).to eq({})
    end

    context "사용성 게이트 (no-key cloud → 요약 모델 폴백)" do
      it "클라우드 provider + auth_token 빈값 + base_url 없음 → 빈 해시 (CHAT_LLM_* 미방출)" do
        llm = { "chat" => { "provider" => "anthropic", "model" => "claude-haiku-4-5", "auth_token" => "", "base_url" => "" } }
        expect(described_class.chat_llm_env(llm)).to eq({})
      end

      it "클라우드 provider + 토큰 없음 + localhost base_url → 방출 (로컬은 키 불요)" do
        llm = { "chat" => { "provider" => "openai", "model" => "qwen", "base_url" => "http://localhost:1234/v1" } }
        env = described_class.chat_llm_env(llm)
        expect(env["CHAT_LLM_PROVIDER"]).to eq("openai")
        expect(env["CHAT_LLM_BASE_URL"]).to eq("http://localhost:1234/v1")
      end

      it "CLI provider(gemini_cli) + 토큰 없음 → 방출 (CLI는 키 불요)" do
        llm = { "chat" => { "provider" => "gemini_cli", "model" => "Gemini 3.5 Flash (Medium)" } }
        expect(described_class.chat_llm_env(llm)["CHAT_LLM_PROVIDER"]).to eq("gemini_cli")
      end

      it "anthropic + 토큰 있음 → 방출" do
        llm = { "chat" => { "provider" => "anthropic", "model" => "claude-haiku-4-5", "auth_token" => "k" } }
        expect(described_class.chat_llm_env(llm)["CHAT_LLM_PROVIDER"]).to eq("anthropic")
      end

      it "openai + 토큰 있음 → 방출" do
        llm = { "chat" => { "provider" => "openai", "model" => "gpt-4o-mini", "auth_token" => "k" } }
        expect(described_class.chat_llm_env(llm)["CHAT_LLM_PROVIDER"]).to eq("openai")
      end

      it "사용 불가(no-key cloud)면 레거시 chat_model이 있어도 그 모델을 방출하지 않는다" do
        # chat 서브해시가 사용 불가면 {} → 요약 모델 폴백.
        # (레거시 chat_model 분기는 chat.provider 가 없을 때만 동작)
        llm = { "chat" => { "provider" => "anthropic", "model" => "claude-haiku-4-5" }, "chat_model" => "opus" }
        expect(described_class.chat_llm_env(llm)).to eq({})
      end
    end
  end

  # idea.md 37: 서버 LLM "선택 안함"(active_preset=="none") — presets 에 "none" 엔트리가 없으므로
  # preset["provider"] || "anthropic" 폴백 함정이 none 을 anthropic 으로 둔갑시키지 않게 차단한다.
  describe ".sync_env_from! — 선택 안함 (active_preset == 'none')" do
    around do |example|
      keys = %w[LLM_PROVIDER LLM_MODEL ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENAI_API_KEY OPENAI_BASE_URL STT_ENGINE]
      prev = keys.index_with { |k| ENV[k] }
      example.run
      keys.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
    end

    it "LLM_PROVIDER=none, LLM_MODEL 삭제, auth_token/base_url 블록 스킵 — chat/stt 는 그대로 실행" do
      ENV["LLM_MODEL"] = "stale-model"
      ENV["ANTHROPIC_AUTH_TOKEN"] = "stale-token"

      cfg = { "llm" => { "active_preset" => "none", "presets" => {} }, "stt" => { "engine" => "whisper_cpp" } }
      described_class.sync_env_from!(cfg)

      expect(ENV["LLM_PROVIDER"]).to eq("none")
      expect(ENV.key?("LLM_MODEL")).to be(false)
      # 함정 회귀: preset["provider"] || "anthropic" 폴백이 none 을 anthropic 으로 둔갑시켰다면
      # 아래 블록(auth_token 갱신)이 실행돼 stale-token 이 지워졌을 것 — 스킵됐으면 불변.
      expect(ENV["ANTHROPIC_AUTH_TOKEN"]).to eq("stale-token")
      # 선택 안함과 무관한 블록(STT 등)은 그대로 실행된다.
      expect(ENV["STT_ENGINE"]).to eq("whisper_cpp")
    end
  end

  # 잡 워커는 puma 에서 fork 된 별도 프로세스라 컨트롤러의 ENV 갱신이 전달되지 않는다.
  # 잡 시작 시 settings.yaml 변경(mtime/size)을 감지해 ENV 를 재동기화한다.
  describe "settings.yaml 변경 감지 재동기화 (refresh_env_if_changed!)" do
    ENV_KEYS = %w[
      LLM_PROVIDER LLM_MODEL LLM_MAX_INPUT_TOKENS LLM_MAX_OUTPUT_TOKENS
      CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_MODEL CHAT_LLM_BASE_URL
      ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OPENAI_API_KEY OPENAI_BASE_URL
      STT_ENGINE HF_TOKEN SUMMARY_INTERVAL_SEC
    ].freeze

    let(:dir) { Dir.mktmpdir }
    let(:path) { File.join(dir, "settings.yaml") }

    def cfg_for(model, chat_model = nil)
      llm = { "active_preset" => "p", "presets" => { "p" => { "provider" => "anthropic", "model" => model, "auth_token" => "tok" } } }
      llm["chat_model"] = chat_model if chat_model
      { "llm" => llm }
    end

    def write_cfg(cfg, mtime: nil)
      File.write(path, YAML.dump(cfg))
      File.utime(mtime, mtime, path) if mtime
    end

    around do |example|
      prev = ENV_KEYS.index_with { |k| ENV[k] }
      ENV_KEYS.each { |k| ENV.delete(k) }
      example.run
      ENV_KEYS.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
    ensure
      FileUtils.remove_entry(dir) if File.exist?(dir)
    end

    before do
      stub_const("AppSettings::SETTINGS_PATH", path)
      described_class.reset_env_sync_state!
    end

    after { described_class.reset_env_sync_state! }

    it "mtime 이 그대로면 미리 넣어 둔 ENV 를 유지한다" do
      t = Time.at(1_700_000_000)
      write_cfg(cfg_for("m1", "c1"), mtime: t)
      described_class.mark_env_synced!
      ENV["LLM_MODEL"] = "injected"
      ENV["CHAT_LLM_MODEL"] = "injected-chat"

      described_class.refresh_env_if_changed!

      expect(ENV["LLM_MODEL"]).to eq("injected")
      expect(ENV["CHAT_LLM_MODEL"]).to eq("injected-chat")
    end

    it "파일 내용과 mtime 이 바뀌면 LLM_MODEL·CHAT_LLM_MODEL 을 갱신한다" do
      write_cfg(cfg_for("m1", "c1"), mtime: Time.at(1_700_000_000))
      described_class.mark_env_synced!
      write_cfg(cfg_for("m2", "c2"), mtime: Time.at(1_700_000_100))

      described_class.refresh_env_if_changed!

      expect(ENV["LLM_MODEL"]).to eq("m2")
      expect(ENV["CHAT_LLM_MODEL"]).to eq("c2")
    end

    it "한 번 동기화한 뒤 같은 파일이면 다시 동기화하지 않는다" do
      write_cfg(cfg_for("m1"), mtime: Time.at(1_700_000_000))
      described_class.mark_env_synced!
      write_cfg(cfg_for("m2"), mtime: Time.at(1_700_000_100))
      described_class.refresh_env_if_changed!
      ENV["LLM_MODEL"] = "after"

      described_class.refresh_env_if_changed!

      expect(ENV["LLM_MODEL"]).to eq("after")
    end

    it "부팅 때 파일이 없었으면(기준값 nil) 파일이 생긴 뒤 첫 호출에서 동기화한다" do
      described_class.mark_env_synced! # 파일 없음 → nil
      write_cfg(cfg_for("late"))

      described_class.refresh_env_if_changed!

      expect(ENV["LLM_MODEL"]).to eq("late")
    end

    it "기준값이 nil 이고 파일도 없으면 ENV 를 건드리지 않는다" do
      ENV["LLM_MODEL"] = "injected"
      described_class.refresh_env_if_changed!
      expect(ENV["LLM_MODEL"]).to eq("injected")
    end

    it "컨트롤러가 sync_env_from! 을 직접 호출하면 기준값이 갱신돼 중복 동기화하지 않는다" do
      write_cfg(cfg_for("m1"), mtime: Time.at(1_700_000_000))
      described_class.mark_env_synced!
      write_cfg(cfg_for("m2"), mtime: Time.at(1_700_000_100))
      described_class.sync_env_from!(described_class.load)
      ENV["LLM_MODEL"] = "after"

      described_class.refresh_env_if_changed!

      expect(ENV["LLM_MODEL"]).to eq("after")
    end

    context "안전장치 — 동기화하지 않고 기준값도 갱신하지 않는다" do
      before do
        write_cfg(cfg_for("m1"), mtime: Time.at(1_700_000_000))
        described_class.mark_env_synced!
        ENV["LLM_MODEL"] = "keep"
      end

      def expect_untouched_then_recovers
        described_class.refresh_env_if_changed!
        expect(ENV["LLM_MODEL"]).to eq("keep")
        write_cfg(cfg_for("good"), mtime: Time.at(1_700_000_300))
        described_class.refresh_env_if_changed!
        expect(ENV["LLM_MODEL"]).to eq("good")
      end

      it "파일이 없을 때" do
        File.delete(path)
        expect_untouched_then_recovers
      end

      it "YAML 이 깨졌을 때" do
        File.write(path, "llm: [unclosed\n  : : :")
        File.utime(Time.at(1_700_000_200), Time.at(1_700_000_200), path)
        expect_untouched_then_recovers
      end

      it "llm 키가 없을 때" do
        write_cfg({ "stt" => { "engine" => "x" } }, mtime: Time.at(1_700_000_200))
        expect_untouched_then_recovers
      end

      it "llm 이 Hash 가 아닐 때" do
        write_cfg({ "llm" => "oops" }, mtime: Time.at(1_700_000_200))
        expect_untouched_then_recovers
      end
    end

    it "동기화 중 예외가 나도 raise 하지 않는다" do
      write_cfg(cfg_for("m1"), mtime: Time.at(1_700_000_000))
      described_class.mark_env_synced!
      write_cfg(cfg_for("m2"), mtime: Time.at(1_700_000_100))
      allow(described_class).to receive(:sync_env_from!).and_raise("boom")
      expect { described_class.refresh_env_if_changed! }.not_to raise_error
    end
  end

  describe ".save! (원자적 쓰기)" do
    let(:dir) { Dir.mktmpdir }
    let(:path) { File.join(dir, "settings.yaml") }

    before { stub_const("AppSettings::SETTINGS_PATH", path) }
    after { FileUtils.remove_entry(dir) }

    it "tmp 파일에 쓴 뒤 rename 하고, 재로드하면 같은 cfg 가 나온다" do
      cfg = { llm: { "active_preset" => "p", "presets" => { "p" => { "model" => "한글" } } }, "stt" => { "engine" => "x" } }
      expect(File).to receive(:rename).and_wrap_original do |orig, from, to|
        expect(File.dirname(from)).to eq(dir)
        expect(from).not_to eq(path)
        expect(to).to eq(path)
        orig.call(from, to)
      end

      described_class.save!(cfg)

      expect(described_class.load).to eq(cfg.deep_stringify_keys)
      expect(Dir.children(dir)).to eq([ "settings.yaml" ]) # tmp 잔류 없음
    end

    it "기존 파일을 덮어쓴다" do
      File.write(path, "old: 1\n")
      described_class.save!({ "new" => 2 })
      expect(described_class.load).to eq({ "new" => 2 })
    end
  end

  describe "ApplicationJob before_perform" do
    it "상속한 잡을 perform_now 하면 refresh_env_if_changed! 가 호출된다" do
      job_class = Class.new(ApplicationJob) { def perform; end }
      stub_const("DummyEnvRefreshJob", job_class)
      expect(described_class).to receive(:refresh_env_if_changed!).once
      DummyEnvRefreshJob.perform_now
    end
  end
end

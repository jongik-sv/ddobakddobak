require "rails_helper"

# refine_notes ok 시그널 (D8 anchor-C1): rescue 시 ok:false → 호출부가 transcript 미소비(무음 손실 차단)
RSpec.describe LlmService, "ok signalling" do
  subject(:service) { described_class.new }

  describe "#refine_notes ok flag (D8 anchor-C1)" do
    it "returns ok:true on success" do
      allow(service).to receive(:call_llm_raw).and_return("## 핵심 요약\n- 내용")
      result = service.refine_notes("기존", [{ "speaker" => "A", "text" => "새 내용" }])
      expect(result["ok"]).to be true
      expect(result["notes_markdown"]).to include("내용")
    end

    it "returns ok:false and unchanged notes when the LLM raises" do
      allow(service).to receive(:call_llm_raw).and_raise(StandardError.new("boom"))
      result = service.refine_notes("기존 회의록", [{ "speaker" => "A", "text" => "새 내용" }])
      expect(result["ok"]).to be false
      expect(result["notes_markdown"]).to eq("기존 회의록")
    end
  end

  # 압축율 5단계: 프롬프트 글자수 캡이 출력량 제어의 유일한 레버(claude_cli 가 max_tokens 무시)
  describe "verbosity instructions" do
    let(:transcripts) { [{ "speaker" => "A", "text" => "새 내용" }] }

    def captured_system_prompt(verbosity, verbosity_context: :final)
      captured = nil
      allow(service).to receive(:call_llm_raw) do |system, _user, **|
        captured = system
        "## 결과"
      end
      service.refine_notes("기존", transcripts, verbosity: verbosity, verbosity_context: verbosity_context)
      captured
    end

    it "appends style + char cap per level" do
      expect(captured_system_prompt("very_concise")).to include("분량 지시 (아주 간결)").and include("약 2,000자")
      expect(captured_system_prompt("concise")).to include("분량 지시 (간결)").and include("약 4,000자")
      expect(captured_system_prompt("detailed")).to include("분량 지시 (상세)").and include("약 15,000자")
    end

    it "uses a tighter cap for realtime ticks than final" do
      expect(captured_system_prompt("standard", verbosity_context: :realtime)).to include("약 4,000자")
      expect(captured_system_prompt("standard", verbosity_context: :final)).to include("약 10,000자")
      expect(captured_system_prompt("very_concise", verbosity_context: :realtime)).to include("약 1,000자")
    end

    it "very_detailed now carries a finite cap (final 20,000 / realtime 10,000) to avoid CLI timeout" do
      final_prompt = captured_system_prompt("very_detailed")
      expect(final_prompt).to include("분량 지시 (아주 상세)")
      expect(final_prompt).to include("약 20,000자")
      expect(final_prompt).to include("자 이내로 유지")
      expect(final_prompt).not_to include("분량 제한 없이")

      realtime_prompt = captured_system_prompt("very_detailed", verbosity_context: :realtime)
      expect(realtime_prompt).to include("약 10,000자")
    end

    it "leaves the prompt unchanged for unknown levels" do
      expect(captured_system_prompt("nonsense")).not_to include("분량 지시")
    end
  end

  # 프롬프트 내보내기에도 압축율 분량 지시 포함 (final 캡)
  describe "#build_prompt verbosity" do
    it "includes the verbosity instruction in the exported prompt" do
      result = service.build_prompt("기존", [{ "speaker" => "A", "text" => "내용" }], verbosity: "concise")
      expect(result["prompt"]).to include("분량 지시 (간결)")
      expect(result["prompt"]).to include("약 4,000자")
    end

    it "leaves the prompt unchanged for standard-with-no-style at export when unknown" do
      result = service.build_prompt("기존", [{ "speaker" => "A", "text" => "내용" }], verbosity: "nonsense")
      expect(result["prompt"]).not_to include("분량 지시")
    end

    it "adds the chronological-flow instruction for incremental meetings" do
      result = service.build_prompt("기존", [{ "speaker" => "A", "text" => "내용" }], restructure: false)
      expect(result["prompt"]).to include("구성 방식 (시간 흐름)")
    end

    it "omits the chronological instruction when restructure is on" do
      result = service.build_prompt("기존", [{ "speaker" => "A", "text" => "내용" }], restructure: true)
      expect(result["prompt"]).not_to include("시간 흐름")
    end
  end

  describe "#refine_notes chronological" do
    it "appends the flow instruction to the system prompt" do
      captured = nil
      allow(service).to receive(:call_llm_raw) do |system, _user, **|
        captured = system
        "## 결과"
      end
      service.refine_notes("기존", [{ "speaker" => "A", "text" => "내용" }], chronological: true)
      expect(captured).to include("구성 방식 (시간 흐름)")
    end
  end

  # 증분(append-only) 모드: 새 자막만 블록으로 요약, 기존 회의록 불변
  describe "#append_notes" do
    let(:transcripts) { [{ "speaker" => "A", "text" => "새 논의" }] }

    it "returns the new block and ok:true" do
      allow(service).to receive(:call_llm_raw).and_return("- 새 논의 정리함")
      result = service.append_notes("기존 회의록", transcripts)
      expect(result["ok"]).to be true
      expect(result["block_markdown"]).to eq("- 새 논의 정리함")
    end

    it "returns ok:true with empty block when there are no transcripts" do
      result = service.append_notes("기존", [])
      expect(result["ok"]).to be true
      expect(result["block_markdown"]).to eq("")
    end

    it "returns ok:false when the LLM raises (호출부 미소비)" do
      allow(service).to receive(:call_llm_raw).and_raise(StandardError.new("boom"))
      result = service.append_notes("기존", transcripts)
      expect(result["ok"]).to be false
      expect(result["block_markdown"]).to eq("")
    end

    it "uses the append system prompt with verbosity instruction" do
      captured = nil
      allow(service).to receive(:call_llm_raw) do |system, _user, **|
        captured = system
        "블록"
      end
      service.append_notes("기존", transcripts, verbosity: "concise")
      expect(captured).to include("증분 방식")
      expect(captured).to include("분량 지시 (간결)")
    end
  end

  describe "#format_transcripts 시각(ms) 노출" do
    it "format_transcripts에 시각(ms)을 노출한다" do
      svc = LlmService.allocate
      out = svc.send(:format_transcripts, [{ "speaker" => "화자 1", "text" => "결정 보류", "started_at_ms" => 125000 }])
      expect(out).to eq("[02:05|125000ms 화자 1] 결정 보류")
    end

    it "라벨과 이름이 둘 다 있으면 대괄호=라벨, 콜론앞=이름" do
      svc = LlmService.allocate
      out = svc.send(:format_transcripts, [{ "speaker_label" => "화자 3", "speaker" => "장종익", "text" => "제안", "started_at_ms" => 53000 }])
      expect(out).to eq("[화자 안내] 화자 3=장종익\n\n[00:53|53000ms 화자 3] 장종익: 제안")
    end
  end

  # CLI_TIMEOUT 기본값: ENV(LLM_CLI_TIMEOUT) 미설정 시 600초 (긴 요약의 CLI 타임아웃 방지)
  describe "CLI_TIMEOUT default" do
    it "defaults to 600 seconds when LLM_CLI_TIMEOUT is unset" do
      skip "LLM_CLI_TIMEOUT is set in this env (#{ENV['LLM_CLI_TIMEOUT']})" if ENV.key?("LLM_CLI_TIMEOUT")
      expect(LlmService::CLI_TIMEOUT).to eq(600)
    end
  end

  describe "#refine_notes 발화근거 마커 지침" do
    it "refine_notes 시스템 프롬프트에 마커 지침이 포함된다" do
      svc = LlmService.new
      captured = nil
      allow(svc).to receive(:call_llm_raw) { |sys, _u, **| captured = sys; "결과" }
      svc.refine_notes("", [{ "speaker" => "화자 1", "text" => "안녕", "started_at_ms" => 0 }], verbosity_context: :realtime)
      expect(captured).to include("⟦t:<ms>/s:<화자>⟧")
      expect(captured).to include("기존 회의록에 이미 있는")
    end
  end
end

RSpec.describe LlmService, "streaming" do
  # anthropic 스트림 흉내: stream.text 가 델타 enumerable 을 반환.
  let(:fake_stream) do
    Struct.new(:deltas) do
      def text = deltas
    end.new(["안녕", "하세", "요"])
  end

  def svc
    s = LlmService.new(llm_config: { provider: "anthropic", auth_token: "k", model: "claude-sonnet-4-20250514" })
    client = instance_double("Anthropic::Client")
    messages = instance_double("Anthropic::Resources::Messages")
    allow(client).to receive(:messages).and_return(messages)
    allow(messages).to receive(:stream).and_return(fake_stream)
    s.instance_variable_set(:@client, client)
    s
  end

  it "블록을 주면 델타를 순서대로 방출하고 전체를 반환한다" do
    seen = []
    full = svc.answer_question("sys", "user") { |d| seen << d }
    expect(seen).to eq(["안녕", "하세", "요"])
    expect(full).to eq("안녕하세요")
  end

  it "CLI provider 도 stdout 청크를 방출한다" do
    s = LlmService.new(llm_config: { provider: "claude_cli", model: "claude-sonnet-4-20250514" })
    # run_cli 를 청크 스텁: 블록에 두 청크 전달, 전체 반환
    allow(s).to receive(:run_cli) do |_cmd, _stdin, &blk|
      blk&.call("부분1 ")
      blk&.call("부분2")
      "부분1 부분2"
    end
    seen = []
    full = s.answer_question("sys", "user") { |d| seen << d }
    expect(seen).to eq(["부분1 ", "부분2"])
    expect(full).to eq("부분1 부분2")
  end
end

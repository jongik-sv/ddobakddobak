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
      # 실패 사유는 사용자 노출용 일반 문구로 정규화 — 예외 원문(내부 정보)은 통과 금지
      expect(result["error"]).to eq(LlmService::GENERIC_USER_ERROR)
      expect(result["error"]).not_to include("boom")
    end

    it "passes through our own LlmError message (한국어 안내문 allowlist)" do
      allow(service).to receive(:call_llm_raw)
        .and_raise(LlmService::LlmError.new("CLI 실행이 실패했습니다 (코드 1)"))
      result = service.refine_notes("기존 회의록", [{ "speaker" => "A", "text" => "새 내용" }])
      expect(result["ok"]).to be false
      expect(result["error"]).to eq("CLI 실행이 실패했습니다 (코드 1)")
    end
  end

  # thinking 누출 방어(solo 2026-07 commit 6209fad 이식, 회의38: 8k자→727자 추론쓰레기로
  # 누적 노트 소실). refine 출력이 기존 노트 대비 절반 미만으로 붕괴하면 저장 거부.
  describe "#refine_notes catastrophic note loss guard" do
    it "rejects a collapsed refine output and preserves the current notes" do
      current = "가" * 2000
      allow(service).to receive(:call_llm_raw).and_return("나" * 700)
      result = service.refine_notes(current, [{ "speaker" => "A", "text" => "새 내용" }])
      expect(result["ok"]).to be false
      expect(result["notes_markdown"]).to eq(current)
      # 가드 발동 사유도 error 로 레포트한다
      expect(result["error"]).to include("대량 유실")
    end

    it "does not trigger when current notes are short (below the floor)" do
      current = "가" * 100
      allow(service).to receive(:call_llm_raw).and_return("")
      result = service.refine_notes(current, [{ "speaker" => "A", "text" => "새 내용" }])
      expect(result["ok"]).to be true
    end

    it "allows growth and stable/near-stable refine output" do
      current = "가" * 2000
      allow(service).to receive(:call_llm_raw).and_return("가" * 2500)
      expect(service.refine_notes(current, [{ "speaker" => "A", "text" => "새 내용" }])["ok"]).to be true

      allow(service).to receive(:call_llm_raw).and_return(current)
      expect(service.refine_notes(current, [{ "speaker" => "A", "text" => "새 내용" }])["ok"]).to be true

      # 소폭 등락(예: 재구조화로 90% 유지)은 오탐 없이 통과.
      allow(service).to receive(:call_llm_raw).and_return("가" * 1800)
      expect(service.refine_notes(current, [{ "speaker" => "A", "text" => "새 내용" }])["ok"]).to be true
    end
  end

  describe "#catastrophic_note_loss? (private helper)" do
    it "detects collapse below half when current notes are substantial" do
      expect(service.send(:catastrophic_note_loss?, "가" * 2000, "나" * 700)).to be true
    end

    it "ignores short current notes" do
      expect(service.send(:catastrophic_note_loss?, "가" * 100, "")).to be false
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
      # 실패 사유는 사용자 노출용 일반 문구로 정규화 — 예외 원문(내부 정보)은 통과 금지
      expect(result["error"]).to eq(LlmService::GENERIC_USER_ERROR)
      expect(result["error"]).not_to include("boom")
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

    it "라벨과 이름이 둘 다 있어도 대괄호=라벨만, 실명(speaker)은 본문 미노출(화자 귀속 제거)" do
      svc = LlmService.allocate
      out = svc.send(:format_transcripts, [{ "speaker_label" => "화자 3", "speaker" => "장종익", "text" => "제안", "started_at_ms" => 53000 }])
      expect(out).to eq("[00:53|53000ms 화자 3] 제안")
    end
  end

  # 회의30 회귀: 라벨 안쪽에 괄호 텍스트(`Full Hard(원소재)`)가 있으면 구(舊)
  # 3-pass 살균기(quote_mermaid_labels)의 paren pass가 `원소재`를 따옴표로
  # 다시 감싸 `["... ("원소재") ..."]` 중첩따옴표를 만들어 mermaid 파싱을
  # 깨뜨렸다(빈 화면). 통합 단일 pass는 `[...]`를 통째로 소비해 내부 괄호를
  # 재매칭하지 않는다. LLM이 낼 수 있는 두 형태(맨라벨/이미 따옴표) 모두 검증.
  describe "#fix_mermaid_quotes 라벨 안 괄호 텍스트 살균기 자기오염 방지" do
    def assert_no_nested_quotes_in_labels(out)
      out.scan(/\[([^\]]*)\]/).each do |(inner)|
        quote_count = inner.count('"')
        expect([0, 2]).to(include(quote_count), "라벨 안 중첩따옴표 검출: #{inner.inspect} (따옴표 #{quote_count}개)")
      end
    end

    it "라벨이 맨 괄호 텍스트(bare)를 포함해도 중첩따옴표를 만들지 않는다" do
      text = "```mermaid\nflowchart TD\n  A[Full Hard(원소재) 출고 + 내국작업신고] --> B[검사]\n```"
      out = LlmService::TextFormatter.fix_mermaid_quotes(text)
      expect(out).to include('A["Full Hard(원소재) 출고 + 내국작업신고"]')
      assert_no_nested_quotes_in_labels(out)
    end

    it "라벨이 이미 따옴표로 감싼 채 괄호 텍스트를 포함해도(+ <br/> 동반) 보존한다" do
      text = "```mermaid\nflowchart TD\n  C[\"완제품 재고화<br/>(인가공업체=사외창고)\"] --> D[영업 출고]\n```"
      out = LlmService::TextFormatter.fix_mermaid_quotes(text)
      expect(out).to include('C["완제품 재고화<br/>(인가공업체=사외창고)"]')
      assert_no_nested_quotes_in_labels(out)
    end

    it "이미 깨진 중첩따옴표 입력도 재-살균으로 치유한다" do
      text = "```mermaid\nflowchart TD\n  A[\"Full Hard(\"원소재\") 출고\"] --> B[x]\n```"
      out = LlmService::TextFormatter.fix_mermaid_quotes(text)
      assert_no_nested_quotes_in_labels(out)
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

# 사용자 노출 오류 메시지 정규화(allowlist): 예외 원문(내부 호스트:포트·경로·CLI stderr)이
# broadcast·DB·meeting_json 으로 참가자 전원에게 새지 않게 한다.
RSpec.describe LlmService, "사용자 노출 오류 메시지 정규화" do
  describe ".user_facing_error_message" do
    it "LlmError 는 원문을 통과시키되 길이를 truncate 한다" do
      long = "가" * (LlmService::USER_ERROR_MAX_LENGTH + 100)
      msg = described_class.user_facing_error_message(LlmService::LlmError.new(long))
      expect(msg.length).to be <= LlmService::USER_ERROR_MAX_LENGTH
      expect(msg).to start_with("가")
    end

    it "그 외 예외는 내부 정보 유출 방지를 위해 일반 문구로 치환한다" do
      e = StandardError.new('Connection refused - connect(2) for "10.0.0.5" port 8443')
      msg = described_class.user_facing_error_message(e)
      expect(msg).to eq(LlmService::GENERIC_USER_ERROR)
      expect(msg).not_to include("10.0.0.5")
    end
  end

  describe "#run_cli 실패 시 stderr 비노출" do
    it "예외 메시지에 stderr 원문(내부 경로)을 포함하지 않고 종료 코드만 노출한다" do
      svc = described_class.new(llm_config: { provider: "anthropic", auth_token: "k", model: "m" })
      expect {
        svc.send(:run_cli, [ "/bin/sh", "-c", "echo /internal/secret/path >&2; exit 3" ], "")
      }.to raise_error(LlmService::LlmError) { |e|
        expect(e.message).not_to include("/internal/secret/path")
        expect(e.message).to include("코드 3")
      }
    end
  end
end

RSpec.describe LlmService, "openai 로컬(Ollama/LM Studio)" do
  it "openai 로컬(키 없음 + base_url)도 클라이언트를 만든다" do
    svc = LlmService.new(llm_config: { provider: "openai", model: "llama-3.1-8b",
                                       base_url: "http://localhost:11434/v1" })
    expect { svc.send(:build_client) }.not_to raise_error
  end
end

# gemini thinking 누출 원인 차단(solo 2026-07 commit 6209fad 이식, 원본 Rails엔 없는
# 의도적 divergence): gemini flash 계열에만 reasoning_effort:"none" 부착.
RSpec.describe LlmService, "openai reasoning_effort gating (gemini flash thinking off)" do
  def svc_for(model)
    LlmService.new(llm_config: { provider: "openai", model: model, base_url: "http://localhost:11434/v1" })
  end

  describe "#openai_reasoning_effort" do
    it "gemini flash 계열에만 \"none\"을 반환한다" do
      expect(svc_for("gemini-flash-latest").send(:openai_reasoning_effort)).to eq("none")
      expect(svc_for("gemini-2.5-flash").send(:openai_reasoning_effort)).to eq("none")
      expect(svc_for("models/gemini-flash-lite-latest").send(:openai_reasoning_effort)).to eq("none")
      expect(svc_for("gemini-2.5-pro").send(:openai_reasoning_effort)).to be_nil
      expect(svc_for("gpt-4o").send(:openai_reasoning_effort)).to be_nil
      expect(svc_for("qwen3-32b").send(:openai_reasoning_effort)).to be_nil
    end
  end

  describe "#call_openai" do
    it "gemini flash 요청 바디에 reasoning_effort:\"none\"을 부착한다" do
      svc = svc_for("gemini-flash-latest")
      client = instance_double("OpenAI::Client")
      captured = nil
      allow(client).to receive(:chat) do |parameters:|
        captured = parameters
        { "choices" => [ { "message" => { "content" => "결과" } } ] }
      end
      svc.instance_variable_set(:@client, client)

      svc.send(:call_openai, "sys", "usr", 4096)
      expect(captured[:reasoning_effort]).to eq("none")
    end

    it "비-gemini 모델은 reasoning_effort를 부착하지 않는다(미지 파라미터 400 방지)" do
      svc = svc_for("gpt-4o")
      client = instance_double("OpenAI::Client")
      captured = nil
      allow(client).to receive(:chat) do |parameters:|
        captured = parameters
        { "choices" => [ { "message" => { "content" => "결과" } } ] }
      end
      svc.instance_variable_set(:@client, client)

      svc.send(:call_openai, "sys", "usr", 4096)
      expect(captured).not_to have_key(:reasoning_effort)
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
    # A안 선제 폴백이 머신 PATH 에 claude 가 없으면 anthropic 으로 갈아끼우므로, CLI 경로 테스트는
    # 바이너리 존재를 명시 스텁해 PATH 비의존으로 고정한다(폴백 미발동 → 기존 CLI 경로 유지).
    allow(s).to receive(:cli_available?).and_return(true)
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

  describe "#take_utf8_prefix! (readpartial 바이트 경계 안전)" do
    let(:svc) { LlmService.new(llm_config: { provider: "claude_cli" }) }

    it "청크 경계서 잘린 멀티바이트(한글)를 유효 UTF-8 만 방출하고 잔여 바이트는 보류한다" do
      ga = "가".b # EA B0 80
      # 첫 청크: "AB" + '가'의 앞 2바이트
      buf = (+"AB").force_encoding(Encoding::BINARY) << ga.byteslice(0, 2)
      out1 = svc.send(:take_utf8_prefix!, buf)
      expect(out1).to eq("AB")
      expect(out1.encoding).to eq(Encoding::UTF_8)
      expect(buf.bytesize).to eq(2) # 미완 2바이트 보류

      # 둘째 청크: '가'의 마지막 바이트 도착 → 완성
      buf << ga.byteslice(2, 1)
      out2 = svc.send(:take_utf8_prefix!, buf)
      expect(out2).to eq("가")
      expect(buf).to be_empty
    end

    it "완전한 UTF-8 바이트는 그대로 방출한다" do
      buf = "안녕".b
      out = svc.send(:take_utf8_prefix!, buf)
      expect(out).to eq("안녕")
      expect(out.valid_encoding?).to be true
      expect(buf).to be_empty
    end
  end
end

# A안(실행시점 폴백): CLI provider 로 추론하려는데 그 바이너리가 이 머신에 없으면 LlmError 로 깨지지 말고
# 디스패치 전에 서버 기본 LLM(server_default_config)으로 선제 폴백해 다시 추론한다.
# 데스크톱(CLI 존재)=개인 CLI 동작 / 원격서버(CLI 없음)=자동 폴백. SERVER_MODE 신호를 쓰지 않아 배포 무관.
RSpec.describe LlmService, "missing-CLI 서버기본 폴백 (A안)" do
  it "(a) CLI 바이너리 부재 시 LlmError 없이 서버 기본(anthropic)으로 폴백 추론한다" do
    svc = LlmService.new(llm_config: { provider: "claude_cli", model: "claude-x" })
    allow(svc).to receive(:cli_available?).and_return(false)
    allow(svc).to receive(:server_default_config)
      .and_return({ provider: "anthropic", auth_token: "k", model: "claude-sonnet-4-20250514" })
    expect(svc).to receive(:call_anthropic).and_return("서버기본 응답")
    expect(svc).not_to receive(:call_claude_cli)

    out = nil
    expect { out = svc.answer_question("sys", "user") }.not_to raise_error
    expect(out).to eq("서버기본 응답")
  end

  it "(a-stream) 스트리밍(&block) 경로도 동일하게 서버 기본으로 폴백한다" do
    svc = LlmService.new(llm_config: { provider: "claude_cli", model: "claude-x" })
    allow(svc).to receive(:cli_available?).and_return(false)
    allow(svc).to receive(:server_default_config)
      .and_return({ provider: "anthropic", auth_token: "k", model: "m" })
    allow(svc).to receive(:call_anthropic_stream) do |_s, _u, _mt, &blk|
      blk.call("델타1")
      blk.call("델타2")
      "델타1델타2"
    end

    seen = []
    full = svc.answer_question("sys", "user") { |d| seen << d }
    expect(seen).to eq([ "델타1", "델타2" ])
    expect(full).to eq("델타1델타2")
  end

  it "(b) CLI 바이너리 존재 시 폴백 없이 기존대로 CLI 를 실행한다" do
    svc = LlmService.new(llm_config: { provider: "claude_cli", model: "claude-x" })
    allow(svc).to receive(:cli_available?).and_return(true)
    expect(svc).to receive(:run_cli).and_return("CLI 응답")
    expect(svc).not_to receive(:call_anthropic)

    expect(svc.answer_question("sys", "user")).to eq("CLI 응답")
  end

  it "(c) 서버 기본마저 CLI 이고 그 바이너리도 부재면 폴백 1회만 → 원래 LlmError 를 raise 한다" do
    svc = LlmService.new(llm_config: { provider: "claude_cli", model: "claude-x" })
    allow(svc).to receive(:cli_available?).and_return(false) # 개인·서버기본 둘 다 부재
    allow(svc).to receive(:server_default_config)
      .and_return({ provider: "gemini_cli", model: "g" })

    expect { svc.answer_question("sys", "user") }.to raise_error(LlmService::LlmError)
  end

  it "(d) 일반 API provider(anthropic)는 폴백 로직 영향 없음 (cli_available? 미조회)" do
    svc = LlmService.new(llm_config: { provider: "anthropic", auth_token: "k", model: "m" })
    expect(svc).not_to receive(:cli_available?)
    expect(svc).to receive(:call_anthropic).and_return("정상")

    expect(svc.answer_question("sys", "user")).to eq("정상")
  end
end

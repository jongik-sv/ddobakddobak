require "rails_helper"

# 안건 자료 압축: 업로드 시점에 LLM 으로 요약해 max_chars(기본 8000) 미만으로 줄인다.
# LLM 이 한도를 넘겨 반환해도 하드 트렁케이트로 입력 토큰 폭증을 막는다(입력 캡 부재 가드).
RSpec.describe LlmService, "#compress_agenda" do
  subject(:service) { described_class.new }

  it "compresses agenda text via the LLM and returns the result" do
    allow(service).to receive(:call_llm_raw).and_return("요약된 안건")
    expect(service.compress_agenda("아주 긴 원본 안건 텍스트")).to eq("요약된 안건")
  end

  it "passes the agenda text to the LLM as user content" do
    captured = nil
    allow(service).to receive(:call_llm_raw) do |_system, user_content, **|
      captured = user_content
      "ok"
    end
    service.compress_agenda("예산안 검토 안건")
    expect(captured).to include("예산안 검토 안건")
  end

  it "hard-truncates output that exceeds max_chars" do
    allow(service).to receive(:call_llm_raw).and_return("가" * 9000)
    result = service.compress_agenda("원본", max_chars: 8000)
    expect(result.length).to eq(8000)
  end

  it "returns empty string for blank input without calling the LLM" do
    expect(service).not_to receive(:call_llm_raw)
    expect(service.compress_agenda("  ")).to eq("")
  end

  it "returns the original text (truncated) if the LLM raises" do
    allow(service).to receive(:call_llm_raw).and_raise(StandardError.new("boom"))
    long = "나" * 9000
    result = service.compress_agenda(long, max_chars: 8000)
    expect(result.length).to eq(8000)
  end
end

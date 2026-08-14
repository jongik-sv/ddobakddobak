require "rails_helper"

# 이해관계자 자료 압축: 업로드 시점에 LLM 으로 요약해 max_chars(기본 8000) 미만으로 줄인다.
# llm_service_compress_agenda_spec.rb 미러.
RSpec.describe LlmService, "#compress_stakeholder" do
  subject(:service) { described_class.new }

  it "compresses stakeholder text via the LLM and returns the result" do
    allow(service).to receive(:call_llm_raw).and_return("요약된 이해관계자")
    expect(service.compress_stakeholder("아주 긴 원본 이해관계자 텍스트")).to eq("요약된 이해관계자")
  end

  it "passes the stakeholder text to the LLM as user content" do
    captured = nil
    allow(service).to receive(:call_llm_raw) do |_system, user_content, **|
      captured = user_content
      "ok"
    end
    service.compress_stakeholder("김철수 / 기획팀 / 팀장")
    expect(captured).to include("김철수 / 기획팀 / 팀장")
  end

  it "hard-truncates output that exceeds max_chars" do
    allow(service).to receive(:call_llm_raw).and_return("가" * 9000)
    result = service.compress_stakeholder("원본", max_chars: 8000)
    expect(result.length).to eq(8000)
  end

  it "returns empty string for blank input without calling the LLM" do
    expect(service).not_to receive(:call_llm_raw)
    expect(service.compress_stakeholder("  ")).to eq("")
  end

  it "returns the original text (truncated) if the LLM raises" do
    allow(service).to receive(:call_llm_raw).and_raise(StandardError.new("boom"))
    long = "나" * 9000
    result = service.compress_stakeholder(long, max_chars: 8000)
    expect(result.length).to eq(8000)
  end
end

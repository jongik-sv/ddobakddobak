require "rails_helper"

RSpec.describe FolderChatQueryExpansion do
  let(:user) { create(:user) }

  # effective_chat_llm_config 분석(keyword spec와 동일):
  # 기본 factory :user는 llm_provider/llm_api_key/llm_enabled?를 설정하지 않으므로
  # llm_configured? → false → effective_llm_config → server_default_llm_config.
  # 이 Hash는 blank?가 아니므로 config.blank? 분기를 통과, LlmService.new가 호출된다.
  # 따라서 instance_double 목이 정상적으로 LlmService 호출을 인터셉트한다.

  it "JSON 객체를 keywords/expansions로 파싱한다(원문 포함)" do
    fake = instance_double(LlmService, answer_question: '{"keywords":["예산"],"expansions":["예산","비용"]}')
    allow(LlmService).to receive(:new).and_return(fake)
    result = described_class.expand("예산", user: user)
    expect(result.keywords).to eq(["예산"])
    expect(result.expansions).to eq(%w[예산 비용])
  end

  it "원문 표현이 expansions 맨 앞에 항상 포함된다" do
    fake = instance_double(LlmService, answer_question: '{"keywords":["시리얼"],"expansions":["RS232","UART"]}')
    allow(LlmService).to receive(:new).and_return(fake)
    result = described_class.expand("시리얼 통신", user: user)
    expect(result.expansions.first).to eq("시리얼 통신")
    expect(result.expansions).to eq(["시리얼 통신", "RS232", "UART"])
  end

  it "MAX_EXPANSIONS=5로 제한한다" do
    fake = instance_double(LlmService, answer_question:
      '{"keywords":["a"],"expansions":["e1","e2","e3","e4","e5","e6","e7"]}')
    allow(LlmService).to receive(:new).and_return(fake)
    result = described_class.expand("질문", user: user)
    expect(result.expansions.size).to eq(5)
  end

  it "코드펜스로 감싼 JSON도 파싱한다" do
    fake = instance_double(LlmService, answer_question:
      "```json\n{\"keywords\":[\"포항공장\"],\"expansions\":[\"포항공장\",\"포항\"]}\n```")
    allow(LlmService).to receive(:new).and_return(fake)
    result = described_class.expand("포항공장", user: user)
    expect(result.keywords).to eq(["포항공장"])
    expect(result.expansions).to eq(%w[포항공장 포항])
  end

  it "LLM 실패 시 폴백한다(keywords=토큰화, expansions=[원문])" do
    allow(LlmService).to receive(:new).and_raise(StandardError, "boom")
    result = described_class.expand("예산 일정 확정", user: user)
    expect(result.keywords).to eq(%w[예산 일정 확정])
    expect(result.expansions).to eq(["예산 일정 확정"])
  end

  it "파싱 불가 응답이면 폴백한다" do
    fake = instance_double(LlmService, answer_question: "그냥 텍스트")
    allow(LlmService).to receive(:new).and_return(fake)
    result = described_class.expand("예산 일정", user: user)
    expect(result.keywords).to eq(%w[예산 일정])
    expect(result.expansions).to eq(["예산 일정"])
  end

  it "keywords 누락 시 토큰화로 채운다" do
    fake = instance_double(LlmService, answer_question: '{"expansions":["비용","경비"]}')
    allow(LlmService).to receive(:new).and_return(fake)
    result = described_class.expand("예산 절감", user: user)
    expect(result.keywords).to eq(%w[예산 절감])
    expect(result.expansions).to eq(["예산 절감", "비용", "경비"])
  end

  it "빈 질문이면 keywords/expansions 모두 빈 배열" do
    result = described_class.expand("", user: user)
    expect(result.keywords).to eq([])
    expect(result.expansions).to eq([])
  end

  it "glossary를 시스템 프롬프트에 주입한다" do
    fake = instance_double(LlmService, answer_question: '{"keywords":["q"],"expansions":["q"]}')
    allow(LlmService).to receive(:new).and_return(fake)
    described_class.expand("q", user: user, glossary: "B1=내부장비")
    expect(fake).to have_received(:answer_question).with(a_string_including("B1=내부장비"), "q")
  end
end

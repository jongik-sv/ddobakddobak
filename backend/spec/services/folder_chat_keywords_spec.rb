require "rails_helper"

RSpec.describe FolderChatKeywords do
  let(:user) { create(:user) }

  # effective_chat_llm_config 분석:
  # 기본 factory :user는 llm_provider/llm_api_key/llm_enabled?를 설정하지 않으므로
  # llm_configured? → false → effective_llm_config → server_default_llm_config.
  # server_default_llm_config는 { provider: "anthropic", auth_token: ENV["ANTHROPIC_AUTH_TOKEN"], ... }.compact
  # 테스트 환경에서 ANTHROPIC_AUTH_TOKEN이 없으면 { provider: "anthropic" }만 남는다.
  # 이 Hash는 blank?가 아니므로(빈 Hash가 아님) config.blank? 분기를 통과, LlmService.new가 호출된다.
  # 따라서 별도 스텁 불필요 — instance_double 목이 정상적으로 LlmService 호출을 인터셉트한다.

  it "LLM이 준 JSON 배열을 키워드로 파싱한다" do
    fake = instance_double(LlmService, answer_question: '["예산","일정"]')
    allow(LlmService).to receive(:new).and_return(fake)
    expect(described_class.extract("지난달 예산 일정 정했어?", user: user)).to eq(%w[예산 일정])
  end

  it "코드펜스로 감싼 JSON도 파싱한다" do
    fake = instance_double(LlmService, answer_question: "```json\n[\"포항공장\"]\n```")
    allow(LlmService).to receive(:new).and_return(fake)
    expect(described_class.extract("포항공장 사례?", user: user)).to eq(["포항공장"])
  end

  it "LLM 실패 시 질문 토큰화로 폴백한다" do
    allow(LlmService).to receive(:new).and_raise(StandardError, "boom")
    expect(described_class.extract("예산 일정 확정", user: user)).to eq(%w[예산 일정 확정])
  end

  it "파싱 불가 응답이면 토큰화 폴백한다" do
    fake = instance_double(LlmService, answer_question: "키워드는 예산과 일정입니다")
    allow(LlmService).to receive(:new).and_return(fake)
    expect(described_class.extract("예산 일정", user: user)).to eq(%w[예산 일정])
  end
end

require "rails_helper"

RSpec.describe Whiteboard::Prompt do
  it "SYSTEM_PROMPT 는 TS 정본과 동일한 sha256 (회귀 가드)" do
    expect(Digest::SHA256.hexdigest(described_class::SYSTEM_PROMPT))
      .to eq("c39e2509ea6c23b27f38c292e6939dd99b5f10749e97c129c9757678ea04f6a6")
  end

  it "user_content / retry_suffix 포맷" do
    m = Whiteboard::Material.new(title: "T", date: "2026-01-02", datetime: "2026-01-02 09:00", markdown: "본문")
    expect(described_class.user_content(m)).to eq("[회의] T\n[일시] 2026-01-02 09:00\n[AI 회의록]\n본문")
    expect(described_class.retry_suffix("x")).to eq("\n\n[이전 응답 오류] 직전 응답이 스키마를 벗어났다: x. 스키마에 맞는 JSON 객체 하나만 다시 출력하라.")
  end
end

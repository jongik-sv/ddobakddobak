require "rails_helper"

RSpec.describe GlossaryEntry do
  let(:folder) { create(:folder) }

  it "유효한 literal 엔트리 저장" do
    e = GlossaryEntry.new(from_text: "회진", to_text: "회의", owner: folder)
    expect(e).to be_valid
    expect(e.match_type).to eq("literal")
  end

  it "from_text 필수" do
    e = GlossaryEntry.new(from_text: "", to_text: "회의", owner: folder)
    expect(e).not_to be_valid
  end

  it "literal 모드에서 from == to 면 무효" do
    e = GlossaryEntry.new(from_text: "회의", to_text: "회의", owner: folder)
    expect(e).not_to be_valid
  end

  it "owner+from+match_type 중복 금지" do
    GlossaryEntry.create!(from_text: "회진", to_text: "회의", owner: folder)
    dup = GlossaryEntry.new(from_text: "회진", to_text: "회담", owner: folder)
    expect(dup).not_to be_valid
  end

  it "from_text 200자 초과 무효" do
    e = GlossaryEntry.new(from_text: "가" * 201, to_text: "x", owner: folder)
    expect(e).not_to be_valid
  end

  it "regex 모드: 잘못된 정규식은 무효" do
    e = GlossaryEntry.new(from_text: "(unclosed", to_text: "x", match_type: "regex", owner: folder)
    expect(e).not_to be_valid
  end

  it "regex 모드: 올바른 정규식은 유효 (from==to 검사 생략)" do
    e = GlossaryEntry.new(from_text: "이사(?!회)", to_text: "의사", match_type: "regex", owner: folder)
    expect(e).to be_valid
  end
end

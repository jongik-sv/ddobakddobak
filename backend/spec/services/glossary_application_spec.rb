require "rails_helper"

RSpec.describe GlossaryApplication do
  def lit(from, to) = { from: from, to: to, match_type: "literal" }
  def rex(from, to) = { from: from, to: to, match_type: "regex" }

  it "literal 치환" do
    expect(GlossaryApplication.apply("회진 시작", [lit("회진", "회의")])).to eq("회의 시작")
  end

  it "여러 엔트리 순차 적용" do
    out = GlossaryApplication.apply("a b", [lit("a", "x"), lit("b", "y")])
    expect(out).to eq("x y")
  end

  it "regex 치환 + 백레퍼런스" do
    out = GlossaryApplication.apply("2026년", [rex('(\d+)년', '\1 year')])
    expect(out).to eq("2026 year")
  end

  it "regex lookahead 로 부분치환 회피" do
    out = GlossaryApplication.apply("이사회 이사", [rex("이사(?!회)", "의사")])
    expect(out).to eq("이사회 의사")
  end

  it "빈 텍스트는 그대로" do
    expect(GlossaryApplication.apply("", [lit("a", "b")])).to eq("")
  end

  it "잘못된/타임아웃 정규식은 해당 엔트리만 스킵하고 텍스트 보존" do
    evil = { from: "(a+)+$", to: "x", match_type: "regex" }
    input = "aaaaaaaaaaaaaaaaaaaaaaaaaaaab"
    stub_const("GlossaryApplication::REGEX_TIMEOUT", 0.01)
    expect(GlossaryApplication.apply(input, [evil])).to eq(input)
  end
end

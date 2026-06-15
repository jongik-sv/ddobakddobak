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

  it "잘못된 정규식은 해당 엔트리만 스킵하고 텍스트 보존" do
    bad = { from: "(unclosed", to: "x", match_type: "regex" }
    expect(GlossaryApplication.apply("(unclosed here", [bad])).to eq("(unclosed here")
  end

  it "정규식 타임아웃은 해당 엔트리만 스킵하고 텍스트 보존 + 경고 로그" do
    entry = { from: "slow", to: "x", match_type: "regex" }
    allow(Regexp).to receive(:new).and_raise(Regexp::TimeoutError)
    expect(Rails.logger).to receive(:warn).with(/glossary/)
    expect(GlossaryApplication.apply("slow text", [entry])).to eq("slow text")
  end

  it "한 엔트리가 타임아웃돼도 나머지 엔트리는 계속 적용된다" do
    allow(Regexp).to receive(:new).and_raise(Regexp::TimeoutError)
    entries = [
      { from: "회진", to: "회의", match_type: "literal" },
      { from: "x",    to: "y",   match_type: "regex" },   # 이건 타임아웃 → 스킵
    ]
    expect(GlossaryApplication.apply("회진 x", entries)).to eq("회의 x")
  end

  it "리터럴 모드는 to의 백레퍼런스 문법을 글자 그대로 치환한다" do
    out = GlossaryApplication.apply("price", [{ from: "price", to: 'p\1ce', match_type: "literal" }])
    expect(out).to eq('p\1ce')
  end
end

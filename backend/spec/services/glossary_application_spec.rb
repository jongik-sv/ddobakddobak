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

  describe ".apply_protecting_markers" do
    # 실서버 실증 사고: 오타 사전에 {from: "250", to: "임가공"} 이 있으면 인용 마커 내부의
    # 숫자(시간ms)가 오염된다. 아래 3건은 그 실측 사례를 그대로 회귀 테스트로 넣은 것이다.
    it "실서버 사고 재현 1: 마커 중간 숫자가 오타 사전에 오염되지 않는다" do
      entry = lit("250", "임가공")
      text = "⟦t:1056250/s:화자 5⟧"
      expect(GlossaryApplication.apply_protecting_markers(text, [entry])).to eq(text)
    end

    it "실서버 사고 재현 2: 마커 앞쪽 숫자가 오염되지 않는다" do
      entry = lit("250", "임가공")
      text = "⟦t:2250050/s:화자 1⟧"
      expect(GlossaryApplication.apply_protecting_markers(text, [entry])).to eq(text)
    end

    it "실서버 사고 재현 3: 마커 뒤쪽 숫자가 오염되지 않는다" do
      entry = lit("250", "임가공")
      text = "⟦t:2182500/s:화자 1⟧"
      expect(GlossaryApplication.apply_protecting_markers(text, [entry])).to eq(text)
    end

    it "마커 바깥 본문의 오타 교정은 정상 동작한다" do
      entry = lit("250", "임가공")
      text = "지난 250번째 회의 ⟦t:1056250/s:화자 5⟧ 참고"
      out = GlossaryApplication.apply_protecting_markers(text, [entry])
      expect(out).to eq("지난 임가공번째 회의 ⟦t:1056250/s:화자 5⟧ 참고")
    end

    it "마커 안의 화자명도 보호된다" do
      entry = lit("화자 5", "발표자")
      text = "⟦t:1000/s:화자 5⟧ 화자 5 발언"
      out = GlossaryApplication.apply_protecting_markers(text, [entry])
      expect(out).to eq("⟦t:1000/s:화자 5⟧ 발표자 발언")
    end

    it "regex 엔트리에서도 마커 보호가 동작한다" do
      entry = rex('\d{3}', "XXX")
      text = "⟦t:1056250/s:화자 5⟧ 850명 참석"
      out = GlossaryApplication.apply_protecting_markers(text, [entry])
      expect(out).to eq("⟦t:1056250/s:화자 5⟧ XXX명 참석")
    end

    it "마커가 없는 텍스트는 #apply 와 동일한 결과를 낸다" do
      entry = lit("회진", "회의")
      text = "회진 시작, 회진 종료"
      expect(GlossaryApplication.apply_protecting_markers(text, [entry]))
        .to eq(GlossaryApplication.apply(text, [entry]))
    end

    it "여러 마커가 있어도 각각 독립적으로 보호·복원된다" do
      entry = lit("1", "일")
      text = "⟦t:111/s:화자 1⟧ 사이 ⟦t:222/s:화자 1⟧"
      out = GlossaryApplication.apply_protecting_markers(text, [entry])
      expect(out).to eq("⟦t:111/s:화자 1⟧ 사이 ⟦t:222/s:화자 1⟧")
    end

    it "빈 텍스트/빈 엔트리는 그대로 반환한다" do
      expect(GlossaryApplication.apply_protecting_markers("", [lit("a", "b")])).to eq("")
      expect(GlossaryApplication.apply_protecting_markers("⟦t:1/s:x⟧", [])).to eq("⟦t:1/s:x⟧")
    end

    it "실서버 사전에 동시에 있었던 지뢰 항목들(7.5→7O, M5→MO, A5→AO, 5→O)이 섞여도 마커는 보호된다" do
      entries = [
        lit("7.5", "7O"), lit("M5", "MO"), lit("A5", "AO"), lit("5", "O"),
        lit("250", "임가공"),
      ]
      text = "⟦t:1056250/s:화자 5⟧ ⟦t:2250050/s:화자 1⟧ ⟦t:2182500/s:화자 1⟧"
      out = GlossaryApplication.apply_protecting_markers(text, entries)
      expect(out).to eq(text)
    end

    # 자리표시자 델리미터(PLACEHOLDER_OPEN/CLOSE/NIBBLE_SEPARATOR)가 실수로 빈 문자열이 되면
    # 토큰과 인덱스의 경계가 사라져 서로 다른 마커의 자리표시자가 문자열 레벨에서 구분 불가능해
    # 질 수 있는데, 위쪽 케이스들처럼 마커 개수가 적으면 우연히 테스트를 통과할 수도 있다.
    # 델리미터가 비어있지 않다는 것 자체를 직접 고정해 그 실패 모드를 차단한다.
    it "자리표시자 델리미터가 비어있지 않다" do
      expect(GlossaryApplication::PLACEHOLDER_OPEN).not_to be_empty
      expect(GlossaryApplication::PLACEHOLDER_CLOSE).not_to be_empty
      expect(GlossaryApplication::NIBBLE_SEPARATOR).not_to be_empty
      expect(GlossaryApplication::PLACEHOLDER_OPEN).not_to eq(GlossaryApplication::PLACEHOLDER_CLOSE)
    end
  end
end

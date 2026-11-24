require "rails_helper"

RSpec.describe SttTermLearning::LineDiff do
  describe ".ops" do
    it "인용 마커만 다른 줄은 equal" do
      ops = described_class.ops("- 우판 압연 ⟦t:1000/s:A⟧", "- 우판 압연 ⟦t:2000/s:B⟧")
      expect(ops.map { _1[:op] }).to eq([ "equal" ])
    end

    it "줄 끝 공백 차이는 equal (줄별 rstrip)" do
      ops = described_class.ops("a  \nb", "a\nb\t")
      expect(ops.map { _1[:op] }).to eq(%w[equal equal])
    end

    it "바뀐 줄(!)은 delete+insert 두 op로 펼친다" do
      ops = described_class.ops("a\n우판 압연\nc", "a\n후판 압연\nc")
      expect(ops).to eq([
        { op: "equal", text: "a" },
        { op: "delete", text: "우판 압연" },
        { op: "insert", text: "후판 압연" },
        { op: "equal", text: "c" }
      ])
    end

    it "nil 입력도 빈 텍스트로 다룬다" do
      expect(described_class.ops(nil, "x")).to eq([ { op: "insert", text: "x" } ])
    end
  end

  describe ".hunks" do
    it "바뀐 줄은 delete+insert, hunks 로 묶인다" do
      ops = described_class.ops("a\n우판 압연\nc", "a\n후판 압연\nc")
      expect(described_class.hunks(ops)).to eq([ { removed: [ "우판 압연" ], added: [ "후판 압연" ] } ])
    end

    it "연속된 비-equal 줄을 한 hunk로, equal 로 끊긴 곳은 따로 묶는다" do
      a = "a\n우판\n씨지엘\nb\n엠이에스\nc"
      b = "a\n후판\nCGL\nb\nMES\nc"
      expect(described_class.hunks(described_class.ops(a, b))).to eq([
        { removed: [ "우판", "씨지엘" ], added: [ "후판", "CGL" ] },
        { removed: [ "엠이에스" ], added: [ "MES" ] }
      ])
    end

    it "공백만 다른 줄 쌍은 제외한다" do
      ops = described_class.ops("a\n- 우판  압연\nc", "a\n-  우판 압연\nc")
      expect(described_class.hunks(ops)).to eq([])
    end

    it "공백만 다른 쌍은 빼고 실제로 바뀐 줄은 남긴다" do
      ops = described_class.ops("x\n우판 압연\n다음  줄\ny", "x\n후판 압연\n다음 줄\ny")
      expect(described_class.hunks(ops)).to eq([ { removed: [ "우판 압연" ], added: [ "후판 압연" ] } ])
    end

    it "한쪽만 있는 hunk(줄 추가만·삭제만)는 제외한다" do
      expect(described_class.hunks(described_class.ops("a\nc", "a\n새 줄\nc"))).to eq([])
      expect(described_class.hunks(described_class.ops("a\n지운 줄\nc", "a\nc"))).to eq([])
    end

    it "공백만 다른 쌍을 빼고 한쪽만 남는 hunk 도 제외한다" do
      ops = described_class.ops("a\n다음  줄\nc", "a\n다음 줄\n새 줄\nc")
      expect(described_class.hunks(ops)).to eq([])
    end

    it "인용 마커만 다른 줄은 hunk 가 없다" do
      ops = described_class.ops("- 우판 ⟦t:1/s:A⟧\n- 둘", "- 우판 ⟦t:9/s:B⟧\n- 둘")
      expect(described_class.hunks(ops)).to eq([])
    end
  end
end

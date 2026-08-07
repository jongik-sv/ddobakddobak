require "rails_helper"

RSpec.describe LlmPrompts::CitationMarkers do
  describe "CITATION_RE" do
    it "슬래시 구분자 마커를 시간·화자로 캡처한다" do
      m = described_class::CITATION_RE.match("결정은 보류됐다. ⟦t:125000/s:화자 1⟧")
      expect(m[1]).to eq("125000")
      expect(m[2]).to eq("화자 1")
    end

    it "파이프 구분자 변형도 매치한다" do
      m = described_class::CITATION_RE.match("⟦t:125000|s:화자 1⟧")
      expect(m[1]).to eq("125000")
      expect(m[2]).to eq("화자 1")
    end

    it "콜론 형태(mm:ss·hh:mm:ss) 시간도 캡처한다" do
      expect(described_class::CITATION_RE.match("⟦t:2:05/s:화자 1⟧")[1]).to eq("2:05")
      expect(described_class::CITATION_RE.match("⟦t:1:02:05/s:화자 1⟧")[1]).to eq("1:02:05")
    end

    it "폴더 스코프 마커(⟦m:..⟧)는 매치하지 않는다" do
      expect(described_class::CITATION_RE.match("⟦m:142/t:125000/s:화자 1⟧")).to be_nil
    end
  end

  describe "FOLDER_CITATION_RE" do
    it "회의id·시간·화자를 캡처한다" do
      m = described_class::FOLDER_CITATION_RE.match("⟦m:142/t:125000/s:화자 1⟧")
      expect(m[1]).to eq("142")
      expect(m[2]).to eq("125000")
      expect(m[3]).to eq("화자 1")
    end

    it "s 앞 구분자의 파이프 변형도 매치한다" do
      m = described_class::FOLDER_CITATION_RE.match("⟦m:142/t:2:05|s:화자 1⟧")
      expect(m[1]).to eq("142")
      expect(m[2]).to eq("2:05")
    end
  end

  describe ".marker_time_to_ms" do
    it "숫자만이면 이미 ms" do
      expect(described_class.marker_time_to_ms("125000")).to eq(125_000)
    end

    it "mm:ss를 ms로 환산한다" do
      expect(described_class.marker_time_to_ms("2:05")).to eq(125_000)
    end

    it "hh:mm:ss를 ms로 환산한다" do
      expect(described_class.marker_time_to_ms("1:02:05")).to eq(3_725_000)
    end
  end

  describe ".format_marker_time" do
    it "원본이 숫자 형태면 ms 숫자로 재직렬화한다" do
      expect(described_class.format_marker_time(65_000, like: "125000")).to eq("65000")
    end

    it "원본이 mm:ss면 mm:ss로 재직렬화한다" do
      expect(described_class.format_marker_time(65_000, like: "2:05")).to eq("1:05")
    end

    it "원본이 hh:mm:ss면 hh:mm:ss로 재직렬화한다(시가 0이어도 3필드 유지)" do
      expect(described_class.format_marker_time(65_000, like: "1:02:05")).to eq("0:01:05")
    end

    it "초 미만은 버린다(mm:ss에 소수 필드가 없음)" do
      expect(described_class.format_marker_time(65_499, like: "2:05")).to eq("1:05")
    end
  end

  describe ".stamp_source_meeting" do
    it "bare t: 마커에 회의id를 각인해 m: 포맷으로 만든다" do
      out = described_class.stamp_source_meeting("결정은 보류됐다. ⟦t:125000/s:화자 1⟧", 142)
      expect(out).to eq("결정은 보류됐다. ⟦m:142/t:125000/s:화자 1⟧")
    end

    it "파이프 구분자·콜론 시간 형태도 원형을 보존한 채 각인한다" do
      out = described_class.stamp_source_meeting("⟦t:2:05|s:화자 1⟧", 7)
      expect(out).to eq("⟦m:7/t:2:05|s:화자 1⟧")
    end

    it "이미 m: 이 붙은 마커는 그대로 둔다(연쇄 연결 원출처 보존)" do
      out = described_class.stamp_source_meeting("⟦m:99/t:125000/s:화자 1⟧", 142)
      expect(out).to eq("⟦m:99/t:125000/s:화자 1⟧")
    end

    it "여러 마커가 섞여 있어도 bare 만 각인한다" do
      out = described_class.stamp_source_meeting("A ⟦t:1000/s:화자 1⟧ B ⟦m:5/t:2000/s:화자 2⟧", 142)
      expect(out).to eq("A ⟦m:142/t:1000/s:화자 1⟧ B ⟦m:5/t:2000/s:화자 2⟧")
    end

    it "마커가 없으면 원문 그대로" do
      expect(described_class.stamp_source_meeting("마커 없는 텍스트", 142)).to eq("마커 없는 텍스트")
    end
  end

  describe ".referenced_meeting_ids" do
    it "m: 마커의 회의id를 정수로 수집한다" do
      text = "예산 확정. ⟦m:142/t:125000/s:화자 1⟧"
      expect(described_class.referenced_meeting_ids(text)).to eq([ 142 ])
    end

    it "중복 id는 한 번만" do
      text = "⟦m:142/t:1000/s:화자 1⟧ ⟦m:142/t:2000/s:화자 2⟧"
      expect(described_class.referenced_meeting_ids(text)).to eq([ 142 ])
    end

    it "연쇄 연결로 여러 id가 공존하면 전부 수집한다" do
      text = "⟦m:1/t:1000/s:화자 1⟧ ⟦m:2/t:2000/s:화자 2⟧ ⟦m:3/t:3000/s:화자 3⟧"
      expect(described_class.referenced_meeting_ids(text)).to eq([ 1, 2, 3 ])
    end

    it "bare t: 마커는 무시한다" do
      expect(described_class.referenced_meeting_ids("⟦t:1000/s:화자 1⟧")).to eq([])
    end

    it "마커가 없으면 빈 배열" do
      expect(described_class.referenced_meeting_ids("")).to eq([])
      expect(described_class.referenced_meeting_ids(nil)).to eq([])
    end
  end
end

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
end

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

  # dev DB 실측 변형 패턴(회의록 생성 LLM 이 정본 마커를 자주 변형해 프론트 정규식 매칭이
  # 깨지고 원문이 그대로 노출되던 사고) 전부를 정본 형식으로 교정한다.
  describe ".normalize" do
    describe "nil/blank 안전" do
      it "nil은 그대로 반환한다" do
        expect(described_class.normalize(nil)).to be_nil
      end

      it "빈 문자열/공백 문자열은 그대로 반환한다" do
        expect(described_class.normalize("")).to eq("")
        expect(described_class.normalize("   ")).to eq("   ")
      end
    end

    describe "정상 마커는 바이트 그대로 보존한다(무변형)" do
      it "ms 시간·파이프 구분자" do
        text = "결정은 보류됐다. ⟦t:125000|s:화자 1⟧"
        expect(described_class.normalize(text)).to eq(text)
      end

      it "콜론 시간(mm:ss·hh:mm:ss)·슬래시 구분자" do
        text = "⟦t:2:05/s:화자 1⟧ 그리고 ⟦t:1:02:05/s:화자 2⟧"
        expect(described_class.normalize(text)).to eq(text)
      end

      it "폴더 스코프 m: 마커" do
        text = "예산 확정. ⟦m:142/t:125000|s:화자 1⟧"
        expect(described_class.normalize(text)).to eq(text)
      end
    end

    describe "실측 패턴 1: ms 단위 붙임(파이프 구분자)" do
      it "⟦t:846000ms|s:화자 2⟧ → ⟦t:846000|s:화자 2⟧" do
        expect(described_class.normalize("⟦t:846000ms|s:화자 2⟧")).to eq("⟦t:846000|s:화자 2⟧")
      end
    end

    describe "실측 패턴 2: ms 단위 + '|s' 구분자 소실(bare colon)" do
      it "⟦t:3794650ms:화자 1⟧ → ⟦t:3794650|s:화자 1⟧" do
        expect(described_class.normalize("⟦t:3794650ms:화자 1⟧")).to eq("⟦t:3794650|s:화자 1⟧")
      end
    end

    describe "실측 패턴 3: ms 단위 + 's:' 라벨 소실" do
      it "⟦t:2854000ms|화자 2⟧ → ⟦t:2854000|s:화자 2⟧" do
        expect(described_class.normalize("⟦t:2854000ms|화자 2⟧")).to eq("⟦t:2854000|s:화자 2⟧")
      end
    end

    describe "실측 패턴 4: s 단위 붙임(슬래시 구분자)" do
      it "⟦t:3160188s/s:화자 1⟧ → ⟦t:3160188/s:화자 1⟧" do
        expect(described_class.normalize("⟦t:3160188s/s:화자 1⟧")).to eq("⟦t:3160188/s:화자 1⟧")
      end
    end

    describe "실측 패턴 5: 닫힘(⟧) 없이 잘리고 화자도 소실된 조각 → 복구 불가, 삭제" do
      it "⟦t:2060644 (문장 끝에서 잘림)" do
        expect(described_class.normalize("합의됐다 ⟦t:2060644")).to eq("합의됐다 ")
      end

      it "⟦t:302 (문장 끝에서 잘림)" do
        expect(described_class.normalize("다음 논의로 ⟦t:302")).to eq("다음 논의로 ")
      end

      it "다른 줄의 정상 마커는 보존하고 잘린 줄만 삭제한다" do
        text = "정상: ⟦t:1000|s:화자 1⟧\n잘림: ⟦t:302"
        expect(described_class.normalize(text)).to eq("정상: ⟦t:1000|s:화자 1⟧\n잘림: ")
      end
    end

    describe "실측 패턴 6: 시간 범위 표현(~, md 취소선/아래첨자 오염 원인)" do
      it "마커 내부 범위 t:A~B는 시작값만 남긴다" do
        expect(described_class.normalize("⟦t:100~200|s:화자⟧")).to eq("⟦t:100|s:화자⟧")
      end

      it "마커 내부 범위 양끝의 단위 접미사도 함께 제거한다" do
        expect(described_class.normalize("⟦t:100ms~200ms|s:화자⟧")).to eq("⟦t:100|s:화자⟧")
      end

      it "마커 사이 범위(⟧~⟦)는 '~'만 공백으로 바꾸고 양쪽 마커를 보존한다" do
        text = "⟦t:100|s:화자⟧~⟦t:200|s:화자⟧"
        expect(described_class.normalize(text)).to eq("⟦t:100|s:화자⟧ ⟦t:200|s:화자⟧")
      end

      it "마커 사이 범위(⟧ ~ ⟦, 공백 포함)도 동일하게 처리한다" do
        text = "⟦t:100|s:화자⟧ ~ ⟦t:200|s:화자⟧"
        expect(described_class.normalize(text)).to eq("⟦t:100|s:화자⟧ ⟦t:200|s:화자⟧")
      end
    end

    describe "멱등성 (normalize(normalize(x)) == normalize(x))" do
      [
        "⟦t:846000ms|s:화자 2⟧",
        "⟦t:3794650ms:화자 1⟧",
        "⟦t:2854000ms|화자 2⟧",
        "⟦t:3160188s/s:화자 1⟧",
        "합의됐다 ⟦t:2060644",
        "⟦t:100~200|s:화자⟧",
        "⟦t:100|s:화자⟧~⟦t:200|s:화자⟧",
        "정상: ⟦t:125000|s:화자 1⟧",
        "⟦m:142/t:125000|s:화자 1⟧"
      ].each do |raw|
        it "#{raw.inspect} 는 재적용해도 더 이상 변하지 않는다" do
          once = described_class.normalize(raw)
          twice = described_class.normalize(once)
          expect(twice).to eq(once)
        end
      end
    end

    describe "마커와 무관한 본문·마커 밖 일반 텍스트는 무변형" do
      it "마커와 무관한 일반 대괄호(⟦)는 보존한다" do
        text = "이 기호⟦는 인용이 아니다⟧ 그냥 텍스트."
        expect(described_class.normalize(text)).to eq(text)
      end

      it "마커 밖 시간 범위 표현('2~3시')은 건드리지 않는다" do
        text = "회의는 2~3시 사이에 예정되어 있다."
        expect(described_class.normalize(text)).to eq(text)
      end

      it "마커 밖 ms 범위 표현('200ms~수 초')은 건드리지 않는다" do
        text = "지연은 200ms~수 초 사이로 관측됐다."
        expect(described_class.normalize(text)).to eq(text)
      end
    end

    describe "교정 불가능하지만 마커스러운 완결 조각(닫힘 O, 정본 형식 불일치)" do
      it "삭제하고 향후 패턴 수집용 로그를 남긴다" do
        allow(Rails.logger).to receive(:info)
        text = "⟦t:abc|s:화자 1⟧" # t: 뒤가 숫자가 아니라 정본 형식과 불일치, 규칙상 복구 불가
        expect(described_class.normalize(text)).to eq("")
        expect(Rails.logger).to have_received(:info).with(/unrepairable/)
      end
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

  describe ".strip_all" do
    it "bare t: 마커와 m: 마커를 모두 제거한다" do
      text = "결정됨. ⟦t:1000/s:화자 1⟧ 예산 승인. ⟦m:7/t:2000/s:화자 2⟧"
      expect(described_class.strip_all(text)).to eq("결정됨.  예산 승인. ")
    end

    it "정상 형식이 아닌(깨진) 마커스러운 조각도 와일드카드로 제거한다" do
      expect(described_class.strip_all("내용 ⟦아무거나⟧ 끝")).to eq("내용  끝")
    end

    it "마커가 없으면 원문 그대로" do
      expect(described_class.strip_all("마커 없는 본문")).to eq("마커 없는 본문")
    end

    it "nil/blank 에도 안전하다" do
      expect(described_class.strip_all(nil)).to eq("")
      expect(described_class.strip_all("")).to eq("")
    end
  end
end

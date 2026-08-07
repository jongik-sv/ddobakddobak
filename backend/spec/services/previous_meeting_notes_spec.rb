require "rails_helper"

# 연결 회의 절취선 분할·재조립 단일 유틸(PreviousMeetingNotes) — Meeting#seed_summary_from_previous!
# 와 MeetingSummarizationJob 이 공유한다.
RSpec.describe PreviousMeetingNotes do
  let(:cut_line) { Meeting::PREVIOUS_MEETING_CUT_LINE }

  describe ".split" do
    it "절취선이 없으면 [nil, 전체문서] 를 반환한다(비연결·구 데이터·절취선 삭제)" do
      top, bottom = described_class.split("# 회의록\n\n## 논의\n내용")
      expect(top).to be_nil
      expect(bottom).to eq("# 회의록\n\n## 논의\n내용")
    end

    it "절취선이 있으면 상단/하단으로 분할하고 절취선 자체는 양쪽 어디에도 포함하지 않는다" do
      text = "## 이전 회의 요약\n\n### A\n압축됨\n\n#{cut_line}\n\n# 현재 회의\n본문"
      top, bottom = described_class.split(text)
      expect(top).to eq("## 이전 회의 요약\n\n### A\n압축됨")
      expect(bottom).to eq("# 현재 회의\n본문")
      expect(top).not_to include(cut_line)
      expect(bottom).not_to include(cut_line)
    end

    it "빈 문자열/nil 입력에도 안전하다" do
      expect(described_class.split(nil)).to eq([ nil, "" ])
      expect(described_class.split("")).to eq([ nil, "" ])
    end

    it "절취선 하단이 비어 있으면 bottom 은 빈 문자열(nil 아님)" do
      text = "## 이전 회의 요약\n\n### A\n압축됨\n\n#{cut_line}\n\n"
      _top, bottom = described_class.split(text)
      expect(bottom).to eq("")
    end

    it "절취선은 있지만 그 앞에 HEADER 가 없으면(구 seeded_merge 문서 — 절취선이 논의 사항 한가운데 인라인) [nil, 전체] 를 반환한다" do
      # 구 지시(seeded_merge_instruction)가 LLM 에게 "논의 사항 안에 절취선 삽입"을 시켰던 실제 형태 재현:
      # 제목·핵심요약·논의(이전분)까지 온 뒤에야 절취선이 나오고, HEADER 는 어디에도 없다.
      old_doc = "# 회의 138\n\n## 1. 핵심 요약\n- 통합 요지\n\n## 2. 논의 사항\n### 이전 논의\n내용A\n\n" \
                "#{cut_line}\n\n### 오늘 논의\n내용B\n\n## 3. 결정사항\n표"
      top, bottom = described_class.split(old_doc)
      expect(top).to be_nil
      expect(bottom).to eq(old_doc)
    end
  end

  describe ".join" do
    it "top 이 없으면(비연결) 절취선 없이 bottom 그대로 반환한다 — split 의 역연산" do
      expect(described_class.join(nil, "본문만")).to eq("본문만")
      expect(described_class.join("", "본문만")).to eq("본문만")
    end

    it "top 이 있으면 top + 절취선 + bottom 을 재조립한다" do
      joined = described_class.join("## 이전 회의 요약\n\n### A\n압축됨", "새 본문")
      expect(joined).to eq("## 이전 회의 요약\n\n### A\n압축됨\n\n#{cut_line}\n\n새 본문")
    end

    it "split 후 join 하면 원문(공백 정규화 제외)과 동일하다 — 왕복 무손실" do
      text = "## 이전 회의 요약\n\n### A\n압축됨\n\n#{cut_line}\n\n본문 그대로"
      top, bottom = described_class.split(text)
      expect(described_class.join(top, bottom)).to eq(text)
    end

    it "구 seeded_merge 문서(HEADER 없이 절취선 인라인)는 split→join 왕복해도 원형이 그대로 유지된다" do
      old_doc = "# 회의 138\n\n## 2. 논의 사항\n내용A\n\n#{cut_line}\n\n내용B"
      top, bottom = described_class.split(old_doc)
      expect(described_class.join(top, bottom)).to eq(old_doc)
    end
  end

  describe ".append_block" do
    it "existing_top 이 없으면(최초 연결) HEADER 부터 새로 생성한다" do
      result = described_class.append_block(nil, "지난주 킥오프", "결정: A안 채택")
      expect(result).to eq("## 이전 회의 요약\n\n### 지난주 킥오프\n\n결정: A안 채택")
    end

    it "existing_top 이 있으면(연쇄 승계) HEADER 를 중복 생성하지 않고 뒤에 이어붙인다" do
      existing = "## 이전 회의 요약\n\n### A\n압축A"
      result = described_class.append_block(existing, "B", "압축B")
      expect(result).to eq("## 이전 회의 요약\n\n### A\n압축A\n\n### B\n\n압축B")
      expect(result.scan("## 이전 회의 요약").size).to eq(1)
    end

    it "block_body 가 blank 면 헤딩만 남긴다(빈 본문으로 폴백)" do
      result = described_class.append_block(nil, "제목만", "")
      expect(result).to eq("## 이전 회의 요약\n\n### 제목만")
    end
  end

  describe ".with_title" do
    it "top 앞에 문서 제목(H1)을 배치한다" do
      result = described_class.with_title("현재 회의", "## 이전 회의 요약\n\n### A\n압축됨")
      expect(result).to eq("# 현재 회의\n\n## 이전 회의 요약\n\n### A\n압축됨")
    end

    it "top 이 blank 면 제목 헤딩만 반환한다" do
      expect(described_class.with_title("현재 회의", nil)).to eq("# 현재 회의")
      expect(described_class.with_title("현재 회의", "")).to eq("# 현재 회의")
    end

    it "title 이 blank 면 top 을 그대로 반환한다(제목 없이 회귀 없음)" do
      top = "## 이전 회의 요약\n\n### A\n압축됨"
      expect(described_class.with_title("", top)).to eq(top)
      expect(described_class.with_title(nil, top)).to eq(top)
    end
  end

  describe ".strip_leading_h1" do
    it "H1 로 시작하면 그 줄과 뒤따르는 빈 줄을 제거한다" do
      text = "# 회의 제목\n\n## 1. 핵심 요약\n내용"
      expect(described_class.strip_leading_h1(text)).to eq("## 1. 핵심 요약\n내용")
    end

    it "H2 이상(##)으로 시작하면 건드리지 않는다" do
      text = "## 이전 회의 요약\n\n### A\n압축됨"
      expect(described_class.strip_leading_h1(text)).to eq(text)
    end

    it "H1 로 시작하지 않으면(일반 본문) 원문 그대로" do
      expect(described_class.strip_leading_h1("본문만 있음")).to eq("본문만 있음")
    end

    it "nil/blank 에도 안전하다" do
      expect(described_class.strip_leading_h1(nil)).to eq("")
      expect(described_class.strip_leading_h1("")).to eq("")
    end

    it "H1 한 줄뿐이면(본문 없음) 제거 후 빈 문자열" do
      expect(described_class.strip_leading_h1("# 제목만")).to eq("")
    end
  end

  describe ".strip_matching_h1" do
    it "H1 텍스트가 title 과 일치하면 그 줄과 뒤따르는 빈 줄을 제거한다(LLM 중복 제거)" do
      text = "# 회의 제목\n\n## 1. 핵심 요약\n내용"
      expect(described_class.strip_matching_h1(text, "회의 제목")).to eq("## 1. 핵심 요약\n내용")
    end

    it "앞뒤 공백만 다르면(trim 비교) 일치로 간주한다" do
      text = "#  회의 제목  \n\n내용"
      expect(described_class.strip_matching_h1(text, "회의 제목")).to eq("내용")
    end

    it "H1 텍스트가 title 과 다르면(사용자 커스텀 H1) 손대지 않는다" do
      text = "# 사용자가 직접 쓴 제목\n\n내용"
      expect(described_class.strip_matching_h1(text, "회의 제목")).to eq(text)
    end

    it "H2 이상(##)으로 시작하면 title 일치 여부와 무관하게 건드리지 않는다" do
      text = "## 회의 제목\n\n내용"
      expect(described_class.strip_matching_h1(text, "회의 제목")).to eq(text)
    end

    it "H1 로 시작하지 않으면(append 모드 결과 등) 원문 그대로" do
      expect(described_class.strip_matching_h1("본문만 있음", "회의 제목")).to eq("본문만 있음")
    end

    it "nil/blank 에도 안전하다" do
      expect(described_class.strip_matching_h1(nil, "제목")).to eq("")
      expect(described_class.strip_matching_h1("", "제목")).to eq("")
    end
  end
end

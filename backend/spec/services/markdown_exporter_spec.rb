require "rails_helper"

RSpec.describe MarkdownExporter do
  let(:user)    { create(:user, name: "홍길동") }
  let(:team)    { create(:team, creator: user) }
  let(:meeting) do
    create(:meeting,
      title:      "2분기 목표 회의",
      team:       team,
      creator:    user,
      status:     "completed",
      started_at: Time.zone.parse("2026-06-02 14:00"),
      ended_at:   Time.zone.parse("2026-06-02 15:30"))
  end

  subject(:exporter) { described_class.new(meeting) }

  # --- 헤더 섹션 ---
  describe "헤더 섹션" do
    it "회의 제목을 H1으로 출력한다" do
      expect(exporter.call).to include("# 2분기 목표 회의")
    end

    it "날짜를 포함한다" do
      expect(exporter.call).to include("2026-06-02")
    end

    it "생성자 이름을 포함한다" do
      expect(exporter.call).to include("홍길동")
    end
  end

  # --- AI 요약 섹션 ---
  describe "AI 요약 섹션" do
    context "final 요약이 있을 때" do
      before do
        create(:summary, meeting: meeting, summary_type: "final",
               key_points: ["핵심 1", "핵심 2"].to_json,
               decisions:  ["결정 1"].to_json,
               discussion_details: ["논의 1"].to_json)
      end

      it "## AI 요약 헤더를 포함한다" do
        expect(exporter.call).to include("## AI 요약")
      end

      it "key_points를 불릿으로 출력한다" do
        result = exporter.call
        expect(result).to include("- 핵심 1")
        expect(result).to include("- 핵심 2")
      end

      it "decisions를 불릿으로 출력한다" do
        expect(exporter.call).to include("- 결정 1")
      end
    end

    context "요약이 없을 때" do
      it "AI 요약 섹션이 없다" do
        expect(described_class.new(meeting, include_summary: true).call)
          .not_to include("## AI 요약")
      end
    end

    context "include_summary: false일 때" do
      before { create(:summary, meeting: meeting, summary_type: "final") }

      it "AI 요약 섹션을 포함하지 않는다" do
        result = described_class.new(meeting, include_summary: false).call
        expect(result).not_to include("## AI 요약")
      end
    end
  end

  # --- Action Items ---
  describe "Action Items 섹션" do
    let!(:summary) { create(:summary, meeting: meeting, summary_type: "final") }

    context "todo 상태 Action Item" do
      before { create(:action_item, meeting: meeting, content: "보고서 작성", status: "todo") }

      it "미완료 체크박스로 출력한다" do
        expect(exporter.call).to include("- [ ] 보고서 작성")
      end
    end

    context "done 상태 Action Item" do
      before { create(:action_item, meeting: meeting, content: "킥오프 준비", status: "done") }

      it "완료 체크박스로 출력한다" do
        expect(exporter.call).to include("- [x] 킥오프 준비")
      end
    end

    context "담당자가 있는 Action Item" do
      let(:assignee) { create(:user, name: "김철수") }
      before do
        create(:action_item, meeting: meeting, content: "계획서 작성",
               status: "todo", assignee: assignee,
               due_date: Date.parse("2026-06-10"))
      end

      it "담당자와 마감일을 포함한다" do
        expect(exporter.call).to include("@김철수")
        expect(exporter.call).to include("2026-06-10")
      end
    end
  end

  # --- 원본 텍스트 섹션 ---
  describe "원본 텍스트 섹션" do
    before do
      create(:transcript, meeting: meeting, speaker_label: "화자1",
             content: "회의를 시작합니다.", started_at_ms: 0, sequence_number: 1)
      create(:transcript, meeting: meeting, speaker_label: "화자2",
             content: "감사합니다.", started_at_ms: 90_000, sequence_number: 2)
    end

    it "## 원본 텍스트 헤더를 포함한다" do
      expect(exporter.call).to include("## 원본 텍스트")
    end

    it "화자 레이블을 굵은 글씨로 출력한다" do
      expect(exporter.call).to include("**화자1**")
      expect(exporter.call).to include("**화자2**")
    end

    it "타임스탬프를 MM:SS 형식으로 출력한다" do
      result = exporter.call
      expect(result).to include("(00:00)")
      expect(result).to include("(01:30)")
    end

    it "발언 내용을 포함한다" do
      result = exporter.call
      expect(result).to include("회의를 시작합니다.")
      expect(result).to include("감사합니다.")
    end

    context "include_transcript: false일 때" do
      it "원본 텍스트 섹션을 포함하지 않는다" do
        result = described_class.new(meeting, include_transcript: false).call
        expect(result).not_to include("## 원본 텍스트")
      end
    end

    context "transcript가 없을 때" do
      let(:empty_meeting) { create(:meeting, team: team, creator: user) }

      it "안내 문구를 포함한다" do
        result = described_class.new(empty_meeting).call
        expect(result).to include("원본 텍스트가 없습니다")
      end
    end
  end

  # --- 섹션 구분선 ---
  describe "섹션 구분선" do
    it "섹션 사이에 구분선(---)을 사용한다" do
      create(:summary, meeting: meeting, summary_type: "final")
      create(:transcript, meeting: meeting)
      expect(exporter.call).to include("---")
    end
  end
end

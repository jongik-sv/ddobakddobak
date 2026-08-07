require "rails_helper"

# 이전 회의 참고(연결 회의) — 상단 고정 요약 블록의 코드 레벨 보호가 요약 잡에 배선됐는지 검증.
# 요약 틱은 절취선 아래(본문)만 LLM 에 전달하고, 상단은 재조립 시 그대로 승계한다.
RSpec.describe MeetingSummarizationJob, "이전 회의 참고 — 상단 고정 보호" do
  let(:user)     { create(:user) }
  let(:project)     { create(:project, creator: user) }
  let(:previous) { create(:meeting, project: project, creator: user, status: "completed") }

  before do
    create(:summary, meeting: previous, summary_type: "final",
           notes_markdown: "## 지난 회의\n- 결정: A안", generated_at: 1.day.ago)
    # 압축은 LlmService 계약 spec(llm_service_seeded_spec)에서 별도 검증 — 여기선 시드 자체를 stub해
    # "상단 고정 문서" 형태만 고정해두고 잡의 분할/보호 배선에 집중한다.
    allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_return("- 결정: A안(압축)")
  end

  context "연결 + 증분(append): 본문은 비연결과 동일하게 append_notes 를 쓴다" do
    let(:meeting) do
      create(:meeting, project: project, creator: user, status: "recording",
             summary_restructure: false, previous_meeting: previous)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "오늘 발화", applied_to_minutes: false)
    end

    it "uses append_notes (refine 안 씀) — previous_meeting_id 는 분기에 관여하지 않는다" do
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- 오늘 새 논의", "ok" => true })
      expect_any_instance_of(LlmService).not_to receive(:refine_notes)

      described_class.perform_now(meeting.id, type: "realtime")
    end

    it "append_notes 에는 절취선 아래(빈 본문)만 전달하고 상단은 pinned_context 로 참고 제공한다" do
      received = {}
      allow_any_instance_of(LlmService).to receive(:append_notes) do |_obj, current_notes, *_args, **kwargs|
        received[:current_notes] = current_notes
        received[:pinned_context] = kwargs[:pinned_context]
        { "block_markdown" => "- 오늘 새 논의", "ok" => true }
      end

      described_class.perform_now(meeting.id, type: "realtime")

      expect(received[:current_notes]).to eq("") # 시드 직후 첫 틱 — 절취선 아래 본문은 비어 있음
      expect(received[:pinned_context]).to include("결정: A안(압축)")
      expect(received[:pinned_context]).not_to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
    end

    it "저장된 notes_markdown 은 상단(이전 요약)+절취선+새 본문으로 재조립된다" do
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- 오늘 새 논의", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      saved = meeting.summaries.find_by(summary_type: "realtime").notes_markdown
      # 문서 최상단은 이 회의 자신의 제목 — "이전 회의 요약"보다 먼저 온다.
      expect(saved).to start_with("# #{meeting.title}\n\n## 이전 회의 요약")
      expect(saved).to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
      expect(saved).to include("- 오늘 새 논의")
      # 상단 블록 내용은 그대로 승계(재작성 안 됨).
      top, = PreviousMeetingNotes.split(saved)
      expect(top).to include("결정: A안(압축)")
    end
  end

  context "연결 + 재구조화: 본문만 refine 대상, 상단은 pinned_context 로만 전달" do
    let(:meeting) do
      create(:meeting, project: project, creator: user, status: "recording",
             summary_restructure: true, previous_meeting: previous)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "오늘 발화", applied_to_minutes: false)
    end

    it "refine_notes 에 절취선 아래(빈 본문)만 current_notes 로 전달한다" do
      received = {}
      allow_any_instance_of(LlmService).to receive(:refine_notes) do |_obj, current_notes, *_args, **kwargs|
        received[:current_notes] = current_notes
        received[:pinned_context] = kwargs[:pinned_context]
        { "notes_markdown" => "# 통합 본문", "ok" => true }
      end

      described_class.perform_now(meeting.id, type: "realtime")

      expect(received[:current_notes]).to eq("")
      expect(received[:pinned_context]).to include("결정: A안(압축)")
    end

    it "저장 시 상단 이전 요약 + 절취선 + refine 결과로 재조립된다" do
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "# 통합 본문", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      saved = meeting.summaries.find_by(summary_type: "realtime").notes_markdown
      top, bottom = PreviousMeetingNotes.split(saved)
      expect(top).to include("결정: A안(압축)")
      # "# 통합 본문"은 이 회의의 제목과 다르므로(strip_matching_h1) 사용자/LLM 임의 H1 로 간주해
      # 보존한다 — 회의 제목과 정확히 일치하는 H1 만 중복 제거 대상.
      expect(bottom).to eq("# 통합 본문")
    end

    it "refine 결과가 H1(제목)로 시작해도 본문 재조립 시 중복 제거되고, 문서 최상단엔 이 회의 자신의 제목만 남는다" do
      # REFINE_NOTES_SYSTEM_PROMPT 규칙 0에 따라 LLM 이 매 틱 본문 첫 줄에 H1 을 다시 쓰는 실측 형태.
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "# #{meeting.title}\n\n## 1. 핵심 요약\n- 요지", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      saved = meeting.summaries.find_by(summary_type: "realtime").notes_markdown
      # 문서 최상단은 이 회의(현재 회의) 자신의 제목 — "이전 회의 요약"보다 먼저 온다.
      expect(saved).to start_with("# #{meeting.title}\n\n## 이전 회의 요약")
      top, bottom = PreviousMeetingNotes.split(saved)
      # top 에는 H1 이 이 회의의 제목 하나만 존재 — refine 이 본문에 다시 쓴 H1 은 하단에 남지 않는다.
      expect(top.scan(/^# .*/)).to eq([ "# #{meeting.title}" ])
      expect(bottom).to eq("## 1. 핵심 요약\n- 요지")
      expect(bottom).not_to include("# #{meeting.title}")
    end

    it "회의명을 바꾼 뒤 다음 틱 재조립 시 pinned_top 의 H1 이 새 제목으로 갱신된다(seed 시점 제목에 동결되지 않음)" do
      original_title = meeting.title
      # 1틱: seed(최초 제목) + 첫 재조립.
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "첫 본문", "ok" => true })
      described_class.perform_now(meeting.id, type: "realtime")
      expect(PreviousMeetingNotes.split(meeting.reload.current_notes_markdown).first).to start_with("# #{original_title}")

      # 회의명 변경 + 새 자막 도착 후 다음 틱(summary_interval_sec 기본 180초 게이트를 넘기기 위해 travel).
      meeting.update!(title: "바뀐 회의 제목")
      create(:transcript, meeting: meeting, sequence_number: 2, content: "추가 발화", applied_to_minutes: false)
      travel 181.seconds do
        allow_any_instance_of(LlmService).to receive(:refine_notes)
          .and_return({ "notes_markdown" => "새 본문", "ok" => true })
        described_class.perform_now(meeting.id, type: "realtime")
      end

      saved = meeting.summaries.find_by(summary_type: "realtime").notes_markdown
      expect(saved).to start_with("# 바뀐 회의 제목\n\n## 이전 회의 요약")
      top, = PreviousMeetingNotes.split(saved)
      expect(top.scan(/^# .*/)).to eq([ "# 바뀐 회의 제목" ])
      expect(top).not_to include(original_title)
    end
  end

  context "비연결 + 증분: append-only, 상단 없음(회귀 없음)" do
    let(:meeting) do
      create(:meeting, project: project, creator: user, status: "recording", summary_restructure: false)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "발화", applied_to_minutes: false)
    end

    it "uses append_notes (refine 안 씀), pinned_context 는 nil" do
      received = {}
      allow_any_instance_of(LlmService).to receive(:append_notes) do |_obj, _current_notes, *_args, **kwargs|
        received[:pinned_context] = kwargs[:pinned_context]
        { "block_markdown" => "- 새 논의", "ok" => true }
      end
      expect_any_instance_of(LlmService).not_to receive(:refine_notes)

      described_class.perform_now(meeting.id, type: "realtime")

      expect(received[:pinned_context]).to be_nil
    end

    it "저장된 notes_markdown 에 절취선이 생기지 않는다" do
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- 새 논의", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      saved = meeting.summaries.find_by(summary_type: "realtime").notes_markdown
      expect(saved).not_to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
    end
  end

  context "연쇄 시나리오: A→B→C 2단 연결" do
    it "C 문서에 A·B 블록이 개별 존재하고, A 블록은 재압축되지 않는다" do
      origin_a = create(:meeting, project: project, creator: user, status: "completed", title: "A회의")
      create(:summary, meeting: origin_a, summary_type: "final",
             notes_markdown: "## A 결정\n- 예산 승인", generated_at: 2.days.ago)

      # B: A를 연결 + 증분 진행 후 완료(자기 회의 본문 보유).
      middle_b = create(:meeting, project: project, creator: user, status: "recording",
                        title: "B회의", summary_restructure: false, previous_meeting: origin_a)
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes) { |_llm, notes, **| "[압축] #{notes.lines.first&.strip}" }
      create(:transcript, meeting: middle_b, sequence_number: 1, content: "B 발화", applied_to_minutes: false)
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- B 자체 결정", "ok" => true })
      described_class.perform_now(middle_b.id, type: "realtime")
      middle_b.update!(status: "completed")

      # C: B를 연결.
      last_c = create(:meeting, project: project, creator: user, status: "recording",
                      title: "C회의", summary_restructure: false, previous_meeting: middle_b)
      create(:transcript, meeting: last_c, sequence_number: 1, content: "C 발화", applied_to_minutes: false)
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- C 자체 결정", "ok" => true })
      described_class.perform_now(last_c.id, type: "realtime")

      saved = last_c.summaries.find_by(summary_type: "realtime").notes_markdown
      top, bottom = PreviousMeetingNotes.split(saved)

      expect(top).to include("### A회의")
      expect(top).to include("### B회의")
      expect(top.scan("## 이전 회의 요약").size).to eq(1)
      # A 블록은 B 시드 시점에 압축된 그대로 승계 — C 연결로 다시 압축되지 않는다.
      expect(top).to include("[압축] ## A 결정")
      expect(bottom).to include("- C 자체 결정")
      # 연쇄 승계돼도 top 의 H1 은 항상 "현재 연결된 회의(C)" 하나뿐 — B 자신의 제목은 승계되지 않는다.
      expect(saved).to start_with("# C회의\n\n## 이전 회의 요약")
      expect(top.scan(/^# .*/)).to eq([ "# C회의" ])
    end
  end
end

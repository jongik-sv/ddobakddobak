require "rails_helper"

# 이전 회의 참고(시드): Meeting#seed_summary_from_previous! — 상단 고정 압축 요약 블록(코드 레벨
# 분리) + 자기참조 검증. LLM 호출(condense_previous_notes)은 전부 stub.
RSpec.describe Meeting, type: :model do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:cut_line) { Meeting::PREVIOUS_MEETING_CUT_LINE }

  describe "#seed_summary_from_previous!" do
    let(:previous) { create(:meeting, project: project, creator: user, status: "completed") }
    let(:meeting)  { create(:meeting, project: project, creator: user, status: "recording", previous_meeting: previous) }

    before do
      create(:summary, meeting: previous, summary_type: "final",
             notes_markdown: "## 지난 회의\n- 결정: A안 채택", generated_at: 1.day.ago)
    end

    it "이전 회의록을 압축해 상단 고정 블록(### <제목>)으로 시드하고 절취선을 코드 레벨로 삽입한다" do
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes)
        .and_return("- 결정: A안 채택(압축)")

      meeting.seed_summary_from_previous!(summary_type: "realtime")

      seeded = meeting.summaries.order(:id).last
      expect(seeded).to be_present
      expect(seeded.summary_type).to eq("realtime")
      # 문서 제목(현재 회의 자신의 제목)이 "이전 회의 요약"보다 먼저 온다(사용자 실사용 피드백).
      expect(seeded.notes_markdown).to start_with("# #{meeting.title}\n\n## 이전 회의 요약")
      expect(seeded.notes_markdown).to include("### #{previous.title}")
      expect(seeded.notes_markdown).to include("- 결정: A안 채택(압축)")
      expect(seeded.notes_markdown).to include(cut_line)
      # 절취선 아래(현재 회의 본문)는 아직 비어 있다 — 요약 틱이 채우는 유일한 영역.
      expect(PreviousMeetingNotes.split(seeded.notes_markdown).last).to eq("")
    end

    it "압축 실패(LLM 예외)면 시드를 실패시키지 않고 각인된 원문 body 를 블록으로 폴백한다" do
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_raise(LlmService::LlmError, "boom")

      expect { meeting.seed_summary_from_previous!(summary_type: "realtime") }.not_to raise_error

      seeded = meeting.summaries.order(:id).last
      expect(seeded.notes_markdown).to include("### #{previous.title}")
      expect(seeded.notes_markdown).to include("결정: A안 채택") # 원문 그대로(압축 안 됨)
      expect(seeded.notes_markdown).to include(cut_line)
    end

    it "압축이 nil 을 반환해도(LLM 미설정 등) 원문 body 를 블록으로 폴백한다" do
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_return(nil)

      meeting.seed_summary_from_previous!(summary_type: "realtime")

      seeded = meeting.summaries.order(:id).last
      expect(seeded.notes_markdown).to include("결정: A안 채택")
    end

    it "재구조화 여부와 무관하게 동일하게 상단 고정 블록으로 시드한다" do
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_return("압축본")
      meeting.update!(summary_restructure: false)

      meeting.seed_summary_from_previous!(summary_type: "realtime")

      seeded = meeting.summaries.order(:id).last
      expect(seeded.notes_markdown).to start_with("# #{meeting.title}\n\n## 이전 회의 요약")
      expect(seeded.notes_markdown).to include(cut_line)
    end

    it "honors the summary_type argument (final)" do
      allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_return("압축본")
      meeting.seed_summary_from_previous!(summary_type: "final")
      expect(meeting.summaries.last.summary_type).to eq("final")
    end

    it "is idempotent — no-op when a summary already exists" do
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 진행 중", generated_at: Time.current)
      expect { meeting.seed_summary_from_previous! }.not_to change { meeting.summaries.count }
    end

    it "no-ops when previous_meeting is nil" do
      solo = create(:meeting, project: project, creator: user, status: "recording")
      expect { solo.seed_summary_from_previous! }.not_to change { solo.summaries.count }
    end

    it "no-ops when the previous meeting has no notes" do
      blank_prev = create(:meeting, project: project, creator: user, status: "completed")
      m = create(:meeting, project: project, creator: user, status: "recording", previous_meeting: blank_prev)
      expect { m.seed_summary_from_previous! }.not_to change { m.summaries.count }
    end

    context "인용 마커 각인 (연결 회의 inert 배지)" do
      before { allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_return(nil) }

      it "이전 회의의 ⟦t:..⟧ 마커에 출처 회의ID를 각인해 ⟦m:<id>/t:..⟧ 로 만든다" do
        marked_prev = create(:meeting, project: project, creator: user, status: "completed")
        create(:summary, meeting: marked_prev, summary_type: "final",
               notes_markdown: "결정은 보류됐다. ⟦t:125000/s:화자 1⟧", generated_at: 1.day.ago)
        m = create(:meeting, project: project, creator: user, status: "recording", previous_meeting: marked_prev)

        m.seed_summary_from_previous!(summary_type: "realtime")

        seeded = m.summaries.order(:id).last
        expect(seeded.notes_markdown).to include("⟦m:#{marked_prev.id}/t:125000/s:화자 1⟧")
        expect(seeded.notes_markdown).not_to include("⟦t:125000/s:화자 1⟧")
      end
    end

    context "연쇄 연결(A→B→C)" do
      # 실제 condense_previous_notes 계약(마커는 코드 레벨로 전부 제거)을 stub 에서도 재현 —
      # 마커 스트립 자체는 llm_service_seeded_spec.rb 에서 별도 검증하므로 여기선 위협하지 않는다.
      before do
        allow_any_instance_of(LlmService).to receive(:condense_previous_notes) do |_llm, notes, **|
          "[압축] #{notes.lines.first.to_s.gsub(/⟦[^⟧]*⟧/, '').strip}"
        end
      end

      it "B→C 연결 시 A 블록(이미 m: 각인)은 재각인·재압축 없이 그대로 승계하고 B 본문만 새로 압축한다" do
        origin = create(:meeting, project: project, creator: user, status: "completed", title: "A회의")
        middle = create(:meeting, project: project, creator: user, status: "completed",
                        title: "B회의", previous_meeting: origin)
        # middle(B) 는 이미 A 를 연결한 상태 — 자신의 seed 로 만들어진 문서 형태를 그대로 재현
        # (제목 H1 이 최상단에 오는 현 포맷 포함).
        create(:summary, meeting: middle, summary_type: "final",
               notes_markdown: "# B회의\n\n## 이전 회의 요약\n\n### A회의\n\n합의됨. ⟦m:#{origin.id}/t:5000/s:화자 1⟧\n\n" \
                               "#{cut_line}\n\nB 자체 결정: 예산 승인 ⟦t:9000/s:화자 2⟧",
               generated_at: 1.day.ago)

        last = create(:meeting, project: project, creator: user, status: "recording",
                      title: "C회의", previous_meeting: middle)
        last.seed_summary_from_previous!(summary_type: "realtime")

        seeded = last.summaries.order(:id).last
        expect(seeded.notes_markdown).to start_with("# C회의\n\n## 이전 회의 요약")
        top, bottom = PreviousMeetingNotes.split(seeded.notes_markdown)

        # B 자신의 제목(H1)은 연쇄 승계 시 걷어내진다 — top 에는 "현재 연결하는 회의(C)"의
        # 제목 H1 하나만 존재해야 한다(줄 단위 비교 — "### B회의"는 부분문자열로 "# B회의"를
        # 포함하므로 include? 로는 오탐한다).
        expect(top.scan(/^# .*/)).to eq([ "# C회의" ])

        # A 블록: 원출처 마커 보존, 재각인되지 않음(⟦m:#{origin.id}/.. 그대로), 재압축 안 됨(원문 그대로 승계).
        a_block = top[/### A회의.*?(?=### B회의|\z)/m]
        expect(a_block).to include("합의됨.") # 압축 프롬프트가 아닌 원문 그대로(재압축 대상 아님)
        expect(a_block).to include("⟦m:#{origin.id}/t:5000/s:화자 1⟧")
        expect(a_block).not_to include("⟦m:#{middle.id}/") # A 블록 안의 마커는 middle 로 재각인되지 않는다

        # B 블록: 새로 추가, B 자신의 body 가 압축되어 들어감 — 압축 블록엔 마커를 남기지 않는다
        # (블록 헤더가 이미 출처 표시, 코드 레벨 스트립 정책).
        b_block = top[/### B회의.*/m]
        expect(b_block).to include("B 자체 결정: 예산 승인")
        expect(b_block).not_to include("⟦")

        # 헤더는 한 번만.
        expect(top.scan("## 이전 회의 요약").size).to eq(1)
        # 하단(C 본문)은 비어 있다.
        expect(bottom).to eq("")
      end
    end

    context "절취선이 없는 previous 문서(구 데이터·비연쇄)" do
      before { allow_any_instance_of(LlmService).to receive(:condense_previous_notes).and_return("압축본") }

      it "previous 문서 전체를 압축 대상 body 로 취급한다" do
        plain_prev = create(:meeting, project: project, creator: user, status: "completed", title: "구형 회의")
        create(:summary, meeting: plain_prev, summary_type: "final",
               notes_markdown: "# 구형 회의\n\n## 논의\n절취선 없는 옛 문서", generated_at: 1.day.ago)
        m = create(:meeting, project: project, creator: user, status: "recording", previous_meeting: plain_prev)

        m.seed_summary_from_previous!(summary_type: "realtime")

        seeded = m.summaries.order(:id).last
        expect(seeded.notes_markdown).to start_with("# #{m.title}\n\n## 이전 회의 요약")
        expect(seeded.notes_markdown).to include("### 구형 회의")
        expect(seeded.notes_markdown).to include("압축본")
        expect(seeded.notes_markdown.scan("## 이전 회의 요약").size).to eq(1)
      end
    end

    context "구 seeded_merge 시절 previous 문서(절취선이 논의 사항 한가운데 인라인, HEADER 없음)" do
      it "HEADER 가드가 걸려 previous 문서 전체를 압축 대상 body 로 취급한다(부분 상단 오인 없음)" do
        captured_notes = nil
        allow_any_instance_of(LlmService).to receive(:condense_previous_notes) do |_llm, notes, **|
          captured_notes = notes
          "압축본"
        end

        legacy_prev = create(:meeting, project: project, creator: user, status: "completed", title: "회의 138")
        legacy_doc = "# 회의 138\n\n## 1. 핵심 요약\n- 통합 요지\n\n## 2. 논의 사항\n### 이전 논의\n내용A\n\n" \
                     "#{cut_line}\n\n### 오늘 논의\n내용B\n\n## 3. 결정사항\n표"
        create(:summary, meeting: legacy_prev, summary_type: "final",
               notes_markdown: legacy_doc, generated_at: 1.day.ago)
        m = create(:meeting, project: project, creator: user, status: "recording", previous_meeting: legacy_prev)

        m.seed_summary_from_previous!(summary_type: "realtime")

        # 압축 호출에 legacy_doc 전체(절취선 포함 원문)가 그대로 넘어갔는지 확인 — 절반만 잘려 들어가지 않는다.
        expect(captured_notes).to eq(legacy_doc)

        seeded = m.summaries.order(:id).last
        # 새 블록 하나로만 승계된다 — "핵심 요약"/"논의 사항" 일부가 별도 상단으로 오인 동결되지 않는다.
        expect(seeded.notes_markdown).to start_with("# #{m.title}\n\n## 이전 회의 요약")
        expect(seeded.notes_markdown).to include("### 회의 138")
        expect(seeded.notes_markdown).to include("압축본")
        expect(seeded.notes_markdown.scan("## 이전 회의 요약").size).to eq(1)
        expect(seeded.notes_markdown.scan("### 회의 138").size).to eq(1)
      end
    end
  end

  describe "#refresh_brief_summary!" do
    let(:meeting) { create(:meeting, project: project, creator: user) }

    it "연결 회의(상단 고정 블록 있음): 상단은 건너뛰고 본문만 brief_summary 추출 대상으로 삼는다" do
      doc = "## 이전 회의 요약\n\n### 지난 회의\n\n이전 회의 결정 사항 요약\n\n#{cut_line}\n\n" \
            "# 현재 회의\n\n오늘 논의한 신규 안건 내용"
      meeting.refresh_brief_summary!(doc)

      expect(meeting.reload.brief_summary).to include("오늘 논의한 신규 안건")
      expect(meeting.brief_summary).not_to include("이전 회의 결정 사항")
    end

    it "상단 고정 블록이 없는(비연결) 문서는 기존과 동일하게 전체를 대상으로 한다" do
      meeting.refresh_brief_summary!("# 회의\n\n일반 회의 내용 요약")
      expect(meeting.reload.brief_summary).to include("일반 회의 내용")
    end

    it "절취선 아래 본문이 비어 있으면(연결 직후 첫 틱 전) brief_summary 를 갱신하지 않는다" do
      doc = "## 이전 회의 요약\n\n### 지난 회의\n\n압축된 이전 내용\n\n#{cut_line}\n\n"
      expect { meeting.refresh_brief_summary!(doc) }.not_to change { meeting.reload.brief_summary }
    end

    it "이미 본문만 넘겨도(절취선 없음) 정상 동작한다 — job.rb 호출 패턴과 호환(이중 분할 안전)" do
      meeting.refresh_brief_summary!("오늘 논의한 신규 안건 내용")
      expect(meeting.reload.brief_summary).to include("오늘 논의한 신규 안건")
    end
  end

  describe "previous_meeting self-reference validation" do
    it "rejects referencing itself" do
      m = create(:meeting, project: project, creator: user)
      m.previous_meeting_id = m.id
      expect(m).not_to be_valid
      expect(m.errors[:previous_meeting_id]).to be_present
    end

    it "allows referencing another meeting" do
      prev = create(:meeting, project: project, creator: user)
      m = create(:meeting, project: project, creator: user)
      m.previous_meeting_id = prev.id
      expect(m).to be_valid
    end
  end
end

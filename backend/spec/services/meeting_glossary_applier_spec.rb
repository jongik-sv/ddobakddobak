require "rails_helper"

RSpec.describe MeetingGlossaryApplier do
  let(:meeting) { create(:meeting) }
  let(:entries) { [{ from: "회진", to: "회의", match_type: "literal" }] }

  before do
    create(:transcript, meeting: meeting, content: "회진 시작")
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "회진 노트")
  end

  describe "#apply_transcripts!" do
    it "트랜스크립트만 교정하고 건수 반환" do
      count = MeetingGlossaryApplier.new(meeting, entries).apply_transcripts!
      expect(count).to eq(1)
      expect(meeting.transcripts.first.content).to eq("회의 시작")
      expect(meeting.summaries.first.notes_markdown).to eq("회진 노트") # 미변경
    end
  end

  describe "#apply_all!" do
    it "전 표면(요약+트랜스크립트) 교정" do
      MeetingGlossaryApplier.new(meeting, entries).apply_all!
      expect(meeting.transcripts.first.content).to eq("회의 시작")
      expect(meeting.summaries.first.reload.notes_markdown).to eq("회의 노트")
    end

    it "빈 엔트리면 아무것도 안 함" do
      expect { MeetingGlossaryApplier.new(meeting, []).apply_all! }.not_to(change { meeting.transcripts.first.content })
    end

    it "blocks / summary 전 컬럼을 교정한다" do
      create(:block, meeting: meeting, content: "회진 블록")
      summary = meeting.summaries.first
      summary.update!(key_points: "회진 포인트", discussion_details: "회진 상세")

      MeetingGlossaryApplier.new(meeting, entries).apply_all!

      expect(meeting.blocks.first.reload.content).to eq("회의 블록")
      expect(summary.reload.key_points).to eq("회의 포인트")
      expect(summary.reload.discussion_details).to eq("회의 상세")
    end

    it "변경된 summary 는 generated_at 을 갱신한다" do
      summary = meeting.summaries.first
      old = 1.day.ago
      summary.update!(generated_at: old)
      MeetingGlossaryApplier.new(meeting, entries).apply_all!
      expect(summary.reload.generated_at).to be > old
    end

    context "인용 마커 보호" do
      # 실서버 실증 사고 재현: {from: "250", to: "임가공"} 사전이 요약 컬럼의 인용 마커
      # 내부 숫자를 오염시켰다. apply_all! 경로(=실제 오타 재적용 진입점)로 그대로 검증한다.
      let(:marker_entries) { [{ from: "250", to: "임가공", match_type: "literal" }] }

      it "summary 4컬럼의 마커는 보호되고, 마커 밖 텍스트는 정상 교정된다" do
        summary = meeting.summaries.first
        summary.update!(
          notes_markdown: "⟦t:1056250/s:화자 5⟧ 250번째 안건",
          key_points: "⟦t:2250050/s:화자 1⟧",
          decisions: "⟦t:2182500/s:화자 1⟧",
          discussion_details: "마커 없는 250 텍스트"
        )

        MeetingGlossaryApplier.new(meeting, marker_entries).apply_all!
        summary.reload

        expect(summary.notes_markdown).to eq("⟦t:1056250/s:화자 5⟧ 임가공번째 안건")
        expect(summary.key_points).to eq("⟦t:2250050/s:화자 1⟧")
        expect(summary.decisions).to eq("⟦t:2182500/s:화자 1⟧")
        expect(summary.discussion_details).to eq("마커 없는 임가공 텍스트")
      end

      it "blocks.content 의 마커도 보호된다" do
        create(:block, meeting: meeting, content: "⟦t:1056250/s:화자 5⟧ 250 논의")

        MeetingGlossaryApplier.new(meeting, marker_entries).apply_all!

        expect(meeting.blocks.first.reload.content).to eq("⟦t:1056250/s:화자 5⟧ 임가공 논의")
      end

      it "transcripts.content 경로는 마커 형태 텍스트라도 보호되지 않는다(전사 교정은 계속 동작)" do
        transcript = meeting.transcripts.first
        transcript.update!(content: "⟦t:1056250/s:화자 5⟧ 발언")

        MeetingGlossaryApplier.new(meeting, marker_entries).apply_all!

        expect(transcript.reload.content).to eq("⟦t:1056임가공/s:화자 5⟧ 발언")
      end
    end
  end
end

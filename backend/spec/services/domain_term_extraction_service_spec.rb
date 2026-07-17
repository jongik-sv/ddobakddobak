require "rails_helper"

RSpec.describe DomainTermExtractionService do
  let(:creator) { create(:user, :with_llm_config) }
  let(:project) { create(:project, creator: creator) }
  let(:meeting) { create(:meeting, project: project, creator: creator) }

  describe "#call" do
    context "회의에 활성 요약이 없으면" do
      it "LLM을 호출하지 않고 nil을 반환한다" do
        expect_any_instance_of(LlmService).not_to receive(:extract_domain_terms)

        expect(described_class.new(meeting).call).to be_nil
      end
    end

    context "요약이 있고 LLM이 정상 응답하면" do
      before do
        meeting.summaries.create!(summary_type: "final", notes_markdown: "# 회의록\nMO 공정 논의", generated_at: Time.current)
        allow_any_instance_of(LlmService).to receive(:extract_domain_terms).and_return(
          [
            { "term" => "MO", "category" => "약어", "definition" => "Manufacturing Order" },
            { "term" => "PLC", "category" => "", "definition" => "프로그램 제어기" }
          ]
        )
      end

      it "정상 항목을 그대로 반환한다(mispronunciations는 빈 배열 기본값)" do
        result = described_class.new(meeting).call

        expect(result).to eq([
          { "term" => "MO", "category" => "약어", "definition" => "Manufacturing Order", "mispronunciations" => [] },
          { "term" => "PLC", "category" => "일반", "definition" => "프로그램 제어기", "mispronunciations" => [] }
        ])
      end

      it "creator&.effective_llm_config로 LlmService를 구성한다" do
        expect(LlmService).to receive(:new).with(llm_config: creator.effective_llm_config).and_call_original

        described_class.new(meeting).call
      end
    end

    context "term이 blank인 항목이 섞여 있으면" do
      before do
        meeting.summaries.create!(summary_type: "final", notes_markdown: "# 회의록", generated_at: Time.current)
        allow_any_instance_of(LlmService).to receive(:extract_domain_terms).and_return(
          [
            { "term" => "  ", "category" => "일반", "definition" => "빈 term" },
            { "term" => "ERP", "category" => "시스템명", "definition" => "전사자원관리" }
          ]
        )
      end

      it "blank term 항목은 drop하고 나머지만 반환한다" do
        result = described_class.new(meeting).call

        expect(result).to eq([ { "term" => "ERP", "category" => "시스템명", "definition" => "전사자원관리", "mispronunciations" => [] } ])
      end
    end

    context "mispronunciations가 포함되어 있으면" do
      before do
        meeting.summaries.create!(summary_type: "final", notes_markdown: "# 회의록\nCGL 논의", generated_at: Time.current)
        allow_any_instance_of(LlmService).to receive(:extract_domain_terms).and_return(
          [
            { "term" => "CGL", "category" => "설비명", "mispronunciations" => [ "씨지엘", " ", "씨지엘" ], "definition" => "용융아연도금라인" }
          ]
        )
      end

      it "문자열 배열로 정규화하고 blank/중복 원문은 제거 없이 strip만 한다" do
        result = described_class.new(meeting).call

        expect(result).to eq([
          { "term" => "CGL", "category" => "설비명", "definition" => "용융아연도금라인", "mispronunciations" => [ "씨지엘", "씨지엘" ] }
        ])
      end
    end

    context "mispronunciations 필드가 없으면" do
      before do
        meeting.summaries.create!(summary_type: "final", notes_markdown: "# 회의록", generated_at: Time.current)
        allow_any_instance_of(LlmService).to receive(:extract_domain_terms).and_return(
          [ { "term" => "ERP", "category" => "시스템명", "definition" => "전사자원관리" } ]
        )
      end

      it "빈 배열로 기본값을 채운다" do
        result = described_class.new(meeting).call

        expect(result).to eq([ { "term" => "ERP", "category" => "시스템명", "definition" => "전사자원관리", "mispronunciations" => [] } ])
      end
    end

    context "category가 blank인 항목이 있으면" do
      before do
        meeting.summaries.create!(summary_type: "final", notes_markdown: "# 회의록", generated_at: Time.current)
        allow_any_instance_of(LlmService).to receive(:extract_domain_terms).and_return(
          [ { "term" => "라인A", "category" => nil, "definition" => "1라인" } ]
        )
      end

      it "category 기본값 '일반'으로 채운다" do
        result = described_class.new(meeting).call

        expect(result).to eq([ { "term" => "라인A", "category" => "일반", "definition" => "1라인", "mispronunciations" => [] } ])
      end
    end

    context "LlmService#extract_domain_terms가 nil을 반환하면" do
      before do
        meeting.summaries.create!(summary_type: "final", notes_markdown: "# 회의록", generated_at: Time.current)
        allow_any_instance_of(LlmService).to receive(:extract_domain_terms).and_return(nil)
      end

      it "nil을 반환한다" do
        expect(described_class.new(meeting).call).to be_nil
      end
    end

    context "LlmService가 예외를 던지면" do
      before do
        meeting.summaries.create!(summary_type: "final", notes_markdown: "# 회의록", generated_at: Time.current)
        allow_any_instance_of(LlmService).to receive(:extract_domain_terms).and_raise(StandardError, "boom")
        allow(Rails.logger).to receive(:error)
      end

      it "raise 없이 nil을 반환한다" do
        expect { described_class.new(meeting).call }.not_to raise_error
        expect(described_class.new(meeting).call).to be_nil
      end
    end
  end
end

require "rails_helper"

# LlmService 는 instance_double 로 stub — 실 LLM 호출 없음.
RSpec.describe SttTermLearning::CandidateExtractor do
  let(:meeting) { create(:meeting) }
  let(:ai_text) { "# 회의록\n- 우판 압연 일정 ⟦t:1000/s:화자 1⟧\n- 기타" }
  let(:human_text) { "# 회의록\n- 후판 압연 일정 ⟦t:1000/s:화자 1⟧\n- 기타" }
  let(:run) { create(:stt_term_learning_run, meeting: meeting, ai_text: ai_text, human_text: human_text) }
  let(:llm) { instance_double(LlmService, model_name: "test-model", extract_stt_misrecognitions: []) }

  before { allow(LlmService).to receive(:new).and_return(llm) }

  describe "#call" do
    context "hunk 가 없으면" do
      let(:human_text) { ai_text.sub("⟦t:1000/s:화자 1⟧", "⟦t:9999/s:화자 2⟧") }

      it "LLM 을 호출하지 않고 feedback 후보만" do
        meeting.glossary_entries.create!(from_text: "씨지엘", to_text: "CGL", match_type: "literal")

        result = described_class.new(run).call

        expect(LlmService).not_to have_received(:new)
        expect(llm).not_to have_received(:extract_stt_misrecognitions)
        expect(result[:llm_model]).to be_nil
        expect(result[:llm_skipped_reason]).to be_nil
        expect(result[:candidates].map(&:to_h)).to eq([
          { wrong: "씨지엘", correct: "CGL", category: "STT", definition: nil, confidence: 1.0, source: "feedback" }
        ])
      end
    end

    it "회의 생성자의 effective_llm_config 로 LlmService 를 만들고 hunk 텍스트를 넘긴다" do
      described_class.new(run).call

      expect(LlmService).to have_received(:new).with(llm_config: meeting.creator.effective_llm_config)
      expect(llm).to have_received(:extract_stt_misrecognitions).with(include("- - 우판 압연 일정", "+ - 후판 압연 일정"), anything)
    end

    it "hunk 텍스트에서 인용 마커를 지운다" do
      described_class.new(run).call
      expect(llm).to have_received(:extract_stt_misrecognitions).with(satisfy { |t| !t.include?("⟦") }, anything)
    end

    it "hunk 텍스트는 MAX_HUNKS_CHARS 안에서 hunk 단위로 담는다(줄 중간에서 자르지 않음)" do
      # equal 줄로 끊어 hunk 를 800개 만든다.
      long_ai = (1..800).map { |i| "공통 #{i}\n우판 압연 #{i}번 줄" }.join("\n")
      long_human = (1..800).map { |i| "공통 #{i}\n후판 압연 #{i}번 줄" }.join("\n")
      run.update!(ai_text: long_ai, human_text: long_human)

      described_class.new(run).call

      expect(llm).to have_received(:extract_stt_misrecognitions).with(satisfy { |t|
        blocks = t.split("\n\n")
        t.length <= described_class::MAX_HUNKS_CHARS &&
          blocks.size > 1 &&
          blocks.each_with_index.all? { |b, i| b == "- 우판 압연 #{i + 1}번 줄\n+ 후판 압연 #{i + 1}번 줄" }
      }, anything)
    end

    it "다음 hunk 가 예산을 넘기면 거기서 멈춘다(첫 hunk 가 예산보다 크면 LLM 을 부르지 않는다)" do
      big = "가" * (described_class::MAX_HUNKS_CHARS + 10)
      run.update!(ai_text: "x\n우판#{big}\ny", human_text: "x\n후판#{big}\ny")

      result = described_class.new(run).call

      expect(LlmService).not_to have_received(:new)
      expect(result[:llm_skipped_reason]).to be_nil
    end

    it "LLM 결과를 Candidate(source llm_diff) 로 정규화, category 빈값은 STT, definition 60자 컷" do
      long_def = "가" * 80
      allow(llm).to receive(:extract_stt_misrecognitions).and_return([
        { "wrong" => " 우판 ", "correct" => "후판", "category" => "", "definition" => long_def, "confidence" => 0.9 },
        { "wrong" => "엠이에스", "correct" => "MES", "category" => "시스템명", "definition" => "제조실행시스템", "confidence" => "0.7" }
      ])

      result = described_class.new(run).call

      expect(result[:llm_model]).to eq("test-model")
      expect(result[:llm_skipped_reason]).to be_nil
      first, second = result[:candidates]
      expect(first).to have_attributes(wrong: "우판", correct: "후판", category: "STT", confidence: 0.9, source: "llm_diff")
      expect(first.definition.length).to eq(60)
      expect(second).to have_attributes(wrong: "엠이에스", correct: "MES", category: "시스템명",
                                        definition: "제조실행시스템", confidence: 0.7, source: "llm_diff")
    end

    it "wrong·correct 가 빈 LLM 항목, Hash 가 아닌 항목은 버린다 (나머지 판정은 Task 6 필터 몫)" do
      allow(llm).to receive(:extract_stt_misrecognitions).and_return([
        { "wrong" => "", "correct" => "후판" },
        { "wrong" => "우판", "correct" => nil },
        "garbage",
        { "wrong" => "우판", "correct" => "후판" }
      ])

      expect(described_class.new(run).call[:candidates].map(&:wrong)).to eq([ "우판" ])
    end

    it "LLM 결과 안의 같은 key 중복은 처음 것만 남긴다" do
      allow(llm).to receive(:extract_stt_misrecognitions).and_return([
        { "wrong" => "우판", "correct" => "후판", "definition" => "첫째" },
        { "wrong" => "우판 ", "correct" => "후판", "definition" => "둘째" }
      ])

      c = described_class.new(run).call[:candidates]
      expect(c.map(&:definition)).to eq([ "첫째" ])
    end

    it "confidence 는 0~1 로 자르고, 숫자가 아니면 nil" do
      allow(llm).to receive(:extract_stt_misrecognitions).and_return([
        { "wrong" => "a1", "correct" => "b1", "confidence" => 1.7 },
        { "wrong" => "a2", "correct" => "b2", "confidence" => -0.2 },
        { "wrong" => "a3", "correct" => "b3", "confidence" => "높음" },
        { "wrong" => "a4", "correct" => "b4" }
      ])

      expect(described_class.new(run).call[:candidates].map(&:confidence)).to eq([ 1.0, 0.0, nil, nil ])
    end

    it "Candidate#wrong_key / #correct_key 는 DomainFile.normalize_key" do
      c = SttTermLearning::Candidate.new(wrong: " MES ", correct: "Cgl")
      expect([ c.wrong_key, c.correct_key ]).to eq([ "mes", "cgl" ])
    end

    it "LLM 이 nil 을 내면 feedback 후보만 남는다" do
      meeting.glossary_entries.create!(from_text: "씨지엘", to_text: "CGL", match_type: "literal")
      allow(llm).to receive(:extract_stt_misrecognitions).and_return(nil)

      expect(described_class.new(run).call[:candidates].map(&:source)).to eq([ "feedback" ])
    end

    it "feedback 과 LLM 이 같은 쌍이면 하나로, source=feedback, LLM definition 채택" do
      meeting.glossary_entries.create!(from_text: "우판", to_text: "후판", match_type: "literal")
      allow(llm).to receive(:extract_stt_misrecognitions).and_return([ { "wrong" => "우판", "correct" => "후판", "definition" => "두꺼운 강판", "confidence" => 0.9 } ])

      c = described_class.new(run).call[:candidates]

      expect(c.size).to eq(1)
      expect(c.first).to have_attributes(source: "feedback", definition: "두꺼운 강판", category: "STT", confidence: 1.0)
    end

    it "합칠 때 key 는 normalize_key 기준(대소문자·앞뒤 공백 무시), 표기는 feedback 것, LLM category 채택" do
      meeting.glossary_entries.create!(from_text: "엠이에스", to_text: "MES", match_type: "literal")
      allow(llm).to receive(:extract_stt_misrecognitions).and_return([ { "wrong" => "엠이에스 ", "correct" => "mes", "category" => "시스템명" } ])
      c = described_class.new(run).call[:candidates]
      expect(c.size).to eq(1)
      expect(c.first).to have_attributes(wrong: "엠이에스", correct: "MES", category: "시스템명", source: "feedback")
    end

    it "feedback 은 enabled·literal 만" do
      meeting.glossary_entries.create!(from_text: "우판", to_text: "후판", match_type: "literal", enabled: false)
      meeting.glossary_entries.create!(from_text: "씨.엘", to_text: "CGL", match_type: "regex")

      expect(described_class.new(run).call[:candidates].select { _1.source == "feedback" }).to eq([])
    end

    it "llm_model 은 추출 호출 '후'에 읽는다(CLI 폴백으로 config 가 바뀔 수 있음)" do
      model = "claude-cli"
      allow(llm).to receive(:model_name) { model }
      allow(llm).to receive(:extract_stt_misrecognitions) { model = "fallback-model"; [] }

      expect(described_class.new(run).call[:llm_model]).to eq("fallback-model")
    end

    it "LlmService.new 가 일반 예외를 내면 llm_skipped_reason=llm_failed, feedback 후보는 유지" do
      allow(LlmService).to receive(:new).and_raise(StandardError, "boom")
      meeting.glossary_entries.create!(from_text: "씨지엘", to_text: "CGL", match_type: "literal")
      expect(Rails.logger).to receive(:error).with(/boom/)

      result = described_class.new(run).call

      expect(result[:llm_skipped_reason]).to eq("llm_failed")
      expect(result[:llm_model]).to be_nil
      expect(result[:candidates].map { [ _1.wrong, _1.source ] }).to eq([ [ "씨지엘", "feedback" ] ])
    end

    it "추출 결과가 nil 이면 llm_skipped_reason=llm_failed" do
      allow(llm).to receive(:extract_stt_misrecognitions).and_return(nil)
      expect(described_class.new(run).call[:llm_skipped_reason]).to eq("llm_failed")
    end

    it "추출 결과가 [] 이면 llm_skipped_reason 은 nil" do
      allow(llm).to receive(:extract_stt_misrecognitions).and_return([])
      result = described_class.new(run).call
      expect(result[:llm_skipped_reason]).to be_nil
      expect(result[:llm_model]).to eq("test-model")
    end

    it "category 가 문자열이 아니면 STT, 30자로 자른다. wrong/correct 가 문자열이 아니면 버린다" do
      allow(llm).to receive(:extract_stt_misrecognitions).and_return([
        { "wrong" => "a1", "correct" => "b1", "category" => { "x" => 1 } },
        { "wrong" => "a2", "correct" => "b2", "category" => "분" * 40 },
        { "wrong" => 123, "correct" => "b3" },
        { "wrong" => "a4", "correct" => [ "b4" ] }
      ])

      c = described_class.new(run).call[:candidates]
      expect(c.map(&:wrong)).to eq(%w[a1 a2])
      expect(c[0].category).to eq("STT")
      expect(c[1].category).to eq("분" * 30)
    end

    it "LLM 항목은 100개까지만 본다" do
      items = (1..120).map { |i| { "wrong" => "w#{i}", "correct" => "c#{i}" } }
      allow(llm).to receive(:extract_stt_misrecognitions).and_return(items)

      c = described_class.new(run).call[:candidates]
      expect(c.size).to eq(100)
      expect(c.last.wrong).to eq("w100")
    end

    it "NotConfiguredError 면 llm_skipped_reason=llm_not_configured, feedback 후보는 유지" do
      allow(LlmService).to receive(:new).and_raise(LlmService::NotConfiguredError, "LLM 선택 안함")
      meeting.glossary_entries.create!(from_text: "씨지엘", to_text: "CGL", match_type: "literal")

      result = described_class.new(run).call

      expect(result[:llm_skipped_reason]).to eq("llm_not_configured")
      expect(result[:llm_model]).to be_nil
      expect(result[:candidates].map { [ _1.wrong, _1.correct, _1.source ] }).to eq([ [ "씨지엘", "CGL", "feedback" ] ])
    end

    it "힌트에 확정·제외 쌍을 넣어 호출한다" do
      project = meeting.project
      create(:stt_misrecognition, project: project, wrong: "씨지엘", correct: "CGL", wrong_key: "씨지엘", correct_key: "cgl", status: "confirmed", hit_count: 1)
      create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "confirmed", hit_count: 5)
      create(:stt_misrecognition, project: project, wrong: "논의했다", correct: "협의했다", wrong_key: "논의했다", correct_key: "협의했다", status: "excluded")
      create(:stt_misrecognition, project: project, wrong: "미정", correct: "결정", wrong_key: "미정", correct_key: "결정", status: "undecided")
      create(:stt_misrecognition, project: create(:project), wrong: "남의", correct: "프로젝트", wrong_key: "남의", correct_key: "프로젝트", status: "confirmed")

      described_class.new(run).call

      expect(llm).to have_received(:extract_stt_misrecognitions)
        .with(anything, "확정: 우판→후판\n확정: 씨지엘→CGL\n제외: 논의했다→협의했다")
    end

    it "확정·제외 힌트는 각 30개까지" do
      project = meeting.project
      32.times { |i| create(:stt_misrecognition, project: project, wrong: "w#{i}", correct: "c#{i}", wrong_key: "w#{i}", correct_key: "c#{i}", status: "confirmed", hit_count: i) }
      32.times { |i| create(:stt_misrecognition, project: project, wrong: "x#{i}", correct: "y#{i}", wrong_key: "x#{i}", correct_key: "y#{i}", status: "excluded") }

      described_class.new(run).call

      expect(llm).to have_received(:extract_stt_misrecognitions).with(anything, satisfy { |h|
        lines = h.split("\n")
        lines.count { _1.start_with?("확정:") } == 30 && lines.count { _1.start_with?("제외:") } == 30 &&
          lines.first == "확정: w31→c31"
      })
    end

    it "확정·제외 쌍이 없으면 힌트는 빈 문자열(미정 쌍은 힌트에 넣지 않는다)" do
      create(:stt_misrecognition, project: meeting.project, status: "undecided")

      described_class.new(run).call

      expect(llm).to have_received(:extract_stt_misrecognitions).with(anything, "")
    end
  end
end

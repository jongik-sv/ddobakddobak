module SttTermLearning
  # 학습 후보 1건. source: "llm_diff"(줄 diff에서 LLM 추출) | "feedback"(회의 교정 사전 literal 항목)
  Candidate = Struct.new(:wrong, :correct, :category, :definition, :confidence, :source, keyword_init: true) do
    def wrong_key
      DomainFile.normalize_key(wrong)
    end

    def correct_key
      DomainFile.normalize_key(correct)
    end

    def key
      [ wrong_key, correct_key ]
    end
  end
end

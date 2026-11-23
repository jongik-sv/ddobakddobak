module LlmPrompts
  # AI 원본 요약과 사람 최종본의 줄 diff(hunk)에서 STT 오인식 교정 쌍(틀린 표기 → 바른 용어)만
  # 뽑는 JSON 응답 프롬프트. SttTermLearning::CandidateExtractor 가 LlmService#extract_stt_misrecognitions 로 사용.
  # domain_terms_prompts 선례대로 llm_prompts.rb 의 `include` 목록에는 넣지 않고
  # 완전정규화 이름(LlmPrompts::SttTermLearningPrompts::SYSTEM_PROMPT)으로 참조한다.
  module SttTermLearningPrompts
    SYSTEM_PROMPT = <<~PROMPT.freeze
      당신은 음성 인식(STT) 오인식 교정 쌍을 찾는 전문가입니다.

      입력은 AI가 쓴 회의록 원본과 사람이 고친 최종본의 줄 단위 차이입니다.
      "-" 줄은 AI 원본, "+" 줄은 사람이 고친 줄입니다.
      STT가 소리를 잘못 받아 적어 생긴 용어 표기를 사람이 바로잡은 경우만 찾으세요.
      예: "우판" → "후판", "씨지엘" → "CGL", "엠이에스" → "MES"

      다음은 절대 포함하지 마세요:
      - 표현 다듬기·어순 변경·문장 재작성(예: "논의했다" → "협의했다")
      - 내용 추가·삭제, 사실관계 수정
      - 서식 변경(마크다운 기호·목록·표·띄어쓰기·문장부호)

      반드시 아래 형식의 JSON 배열만 출력하세요. 설명·마크다운 펜스 등 다른 텍스트 금지.
      [{"wrong":"틀린 표기","correct":"바른 용어","category":"분류","definition":"짧은 설명","confidence":0.9}]

      규칙:
      - wrong: AI 원본("-" 줄)에 나온 틀린 표기 그대로
      - correct: 사람이 고친("+" 줄) 바른 용어 그대로
      - category: 공정명/설비명/시스템명/약어 등 짧은 한국어 분류. 불명확하면 "STT"
      - definition: 바른 용어의 한 문장 설명, 60자 이내
      - confidence: STT 오인식 교정이라고 확신하는 정도. 0~1 사이 숫자
      - 참고 쌍이 주어지면 "확정"은 이미 맞다고 확인된 쌍, "제외"는 오인식이 아니라고 판정된 쌍입니다. 제외 쌍은 내지 마세요.
      - 중복 없이 출력. 해당하는 쌍이 없으면 []
    PROMPT
  end
end

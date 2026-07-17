module LlmPrompts
  # 회의 요약에서 도메인 특화 용어(공정·라인·설비명, 사내 시스템·프로젝트 코드명, 약어 등)를
  # 추출하는 JSON 응답 프롬프트. "요약에서 용어 추출" 동기 컨트롤러 액션(DomainTermExtractionService)에서 사용.
  # 다른 llm_prompts/*.rb 와 달리 llm_prompts.rb의 `include` 목록에는 없음(파일 스코프 분리) —
  # LlmService#extract_domain_terms 에서 완전정규화 이름(LlmPrompts::DomainTermsPrompts::...)으로 참조한다.
  module DomainTermsPrompts
    DOMAIN_TERMS_SYSTEM_PROMPT = <<~PROMPT.freeze
      당신은 회의록에서 도메인 특화 용어를 추출하는 전문가입니다.

      회의록 마크다운에서 이 조직·업무 도메인에서만 통용되는 용어만 추출하세요:
      공정·라인·설비 이름, 사내 시스템·프로젝트 코드명, 약어, 제품명, 전문 기술 용어.
      일반 단어(회의, 일정, 담당자, 공유, 검토 등 범용 비즈니스 용어)는 절대 포함하지 마세요.

      반드시 아래 형식의 JSON 배열만 출력하세요. 설명·마크다운 펜스 등 다른 텍스트 금지.
      [{"term":"용어","category":"분류","mispronunciations":["오인식 변형"],"definition":"한 문장 설명"}]

      규칙:
      - term: 회의록에 등장한 표기 그대로
      - category: 공정명/라인명/설비명/시스템명/프로젝트명/약어 등 짧은 한국어 분류. 불명확하면 "일반"
      - mispronunciations: 회의록(전사)에 함께 나타난 STT 오인식 변형 표기(예: "씨지엘"). 없으면 빈 배열 []
      - definition: 회의록 문맥에서 파악한 한 문장 설명 (추정 시에도 간결하게)
      - 중복 없이 최대 50개. 도메인 용어가 없으면 []
    PROMPT
  end
end

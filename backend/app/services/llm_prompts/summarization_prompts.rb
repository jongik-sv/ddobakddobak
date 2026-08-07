module LlmPrompts
  # 구조화 요약(summarize)·Action Item 추출(summarize_action_items) 프롬프트는
  # 해당 LlmService 메서드 제거(action_items 기능 삭제)와 함께 비워졌다.
  # 모듈 자체는 LlmPrompts 의 nested concern 구성(llm_prompts.rb `include SummarizationPrompts`)을
  # 보존하기 위해 남긴다.
  module SummarizationPrompts
  end
end

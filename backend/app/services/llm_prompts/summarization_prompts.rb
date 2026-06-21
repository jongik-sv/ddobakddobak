module LlmPrompts
  # 구조화 요약·Action Item 추출용 JSON 응답 프롬프트.
  module SummarizationPrompts
    SUMMARIZE_SYSTEM_PROMPT = <<~PROMPT.freeze
      회의 내용 분석·구조화 요약 전문가. 트랜스크립트를 분석해 반드시 아래 JSON 형식으로만 응답.

      응답 형식:
      {
        "key_points": ["핵심 포인트 1", "핵심 포인트 2"],
        "decisions": ["결정사항 1", "결정사항 2"],
        "discussion_details": ["논의 내용 1", "논의 내용 2"],
        "action_items": [
          {"content": "할 일 내용", "assignee_hint": "담당자 힌트 또는 null", "due_date_hint": "마감일 힌트 또는 null"}
        ]
      }

      JSON 외 텍스트 포함 금지.
    PROMPT

    ACTION_ITEMS_SYSTEM_PROMPT = <<~PROMPT.freeze
      회의 내용에서 Action Item 추출 전문가. 트랜스크립트를 분석해 반드시 아래 JSON 형식으로만 응답.

      응답 형식:
      {
        "action_items": [
          {"content": "할 일 내용", "assignee_hint": "담당자 힌트 또는 null", "due_date_hint": "마감일 힌트 또는 null"}
        ]
      }

      JSON 외 텍스트 포함 금지.
    PROMPT
  end
end

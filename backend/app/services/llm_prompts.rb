# LlmService가 사용하는 시스템 프롬프트 상수 모음.
# 로직과 분리된 대용량 프롬프트 텍스트만 보관한다.
#
# 상수는 도메인별 nested concern(app/services/llm_prompts/*.rb)으로 분리하고
# 여기서 re-include 한다. 이렇게 하면 외부의 qualified 접근(LlmPrompts::REFINE_NOTES_SYSTEM_PROMPT)과
# LlmService 의 unqualified 접근(`include LlmPrompts` 후 REFINE_NOTES_SYSTEM_PROMPT) 양쪽이 모두 동작한다.
module LlmPrompts
  # CitationPrompts/MermaidPrompts 는 NotesPrompts·ChatPrompts 가 로드 시점에 보간하므로 먼저 include.
  include SummarizationPrompts
  include CompressionConfig
  include CitationPrompts
  include MermaidPrompts
  include NotesPrompts
  include ChatPrompts
  include AgendaPrompts
end

# 자연어 질문 → {keywords:, expansions:}. 단일 경량 LLM 호출로 FTS 키워드 + 검색 확장어를 동시에 뽑는다.
# 확장어(원문 동의어·약어·다른 표현)는 의미검색 recall을 높인다. 실패/파싱불가 시 graceful 폴백.
# ⚠️ 추가 LLM 호출 0 — 기존 키워드 호출 자리를 그대로 대체(FolderChatKeywords 후신).
class FolderChatQueryExpansion
  MAX_KEYWORDS   = 5
  MAX_EXPANSIONS = 5

  Result = Struct.new(:keywords, :expansions, keyword_init: true)

  def self.expand(question, user:, glossary: nil)
    new(question, user, glossary).expand
  end

  def initialize(question, user, glossary = nil)
    @question = question.to_s.strip
    @user     = user
    @glossary = glossary.to_s.strip
  end

  def expand
    return Result.new(keywords: [], expansions: []) if @question.blank?

    config = @user.effective_chat_llm_config
    return fallback if config.blank?

    raw = LlmService.new(llm_config: config).answer_question(prompt, @question)
    parse(raw) || fallback
  rescue StandardError => e
    Rails.logger.warn "[FolderChatQueryExpansion] #{e.message} — 폴백"
    fallback
  end

  private

  def prompt
    p = LlmPrompts::FOLDER_CHAT_EXPANSION_PROMPT
    p += "\n\n[사내 용어 참고]\n#{@glossary}" if @glossary.present?
    p
  end

  def parse(raw)
    json = raw.to_s[/\{.*\}/m] # 코드펜스·잡설 안의 첫 JSON 객체
    return nil unless json

    obj = JSON.parse(json)
    return nil unless obj.is_a?(Hash)

    Result.new(
      keywords:   clean(obj["keywords"], MAX_KEYWORDS).presence || tokenized,
      expansions: with_original(clean(obj["expansions"], MAX_EXPANSIONS))
    )
  rescue JSON::ParserError
    nil
  end

  def clean(arr, max)
    Array(arr).map { |w| w.to_s.strip }.reject(&:blank?).first(max)
  end

  # 원문 표현은 항상 expansions 맨 앞에 포함(의미검색 품질 회귀 방지).
  def with_original(arr)
    ([ @question ] + arr).map { |w| w.to_s.strip }.reject(&:blank?).uniq.first(MAX_EXPANSIONS)
  end

  def tokenized
    @question.split(/\s+/).reject(&:blank?).first(MAX_KEYWORDS)
  end

  def fallback
    Result.new(keywords: tokenized, expansions: [ @question ])
  end
end

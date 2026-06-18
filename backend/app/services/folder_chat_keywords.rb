# 자연어 질문 → FTS 검색 키워드 배열. 경량 LLM 호출, 실패/파싱불가 시 토큰화 폴백(graceful).
class FolderChatKeywords
  MAX_KEYWORDS = 5

  def self.extract(question, user:)
    new(question, user).extract
  end

  def initialize(question, user)
    @question = question.to_s.strip
    @user = user
  end

  def extract
    return [] if @question.blank?

    config = @user.effective_chat_llm_config
    return fallback if config.blank?

    raw = LlmService.new(llm_config: config)
                    .answer_question(LlmPrompts::FOLDER_CHAT_KEYWORD_PROMPT, @question)
    parse(raw).presence || fallback
  rescue StandardError => e
    Rails.logger.warn "[FolderChatKeywords] #{e.message} — 토큰화 폴백"
    fallback
  end

  private

  def parse(raw)
    json = raw.to_s[/\[[^\]]*\]/m] # 코드펜스·잡설 안의 첫 JSON 배열
    return [] unless json

    arr = JSON.parse(json)
    return [] unless arr.is_a?(Array)

    arr.map { |w| w.to_s.strip }.reject(&:blank?).first(MAX_KEYWORDS)
  rescue JSON::ParserError
    []
  end

  def fallback
    @question.split(/\s+/).reject(&:blank?).first(MAX_KEYWORDS)
  end
end

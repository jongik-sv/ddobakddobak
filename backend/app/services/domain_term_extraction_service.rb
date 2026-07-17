# 회의의 최종(활성) 요약에서 도메인 특화 용어를 LLM으로 추출한다.
# "요약에서 용어 추출" 컨트롤러 액션(동기, 신규 잡 클래스 금지)에서 호출.
# LLM = meeting.creator&.effective_llm_config(녹음자 규칙, meeting_finalizer_service.rb 동일 패턴).
class DomainTermExtractionService
  def initialize(meeting)
    @meeting = meeting
  end

  # @return [Array<Hash>, nil] [{"term"=>, "category"=>, "definition"=>}, ...] | nil(실패)
  #   - LLM 응답이 배열이 아니거나(nil 포함) 예외 발생 시 nil (raise 금지)
  #   - term blank 항목은 drop, category blank는 "일반"로 기본값, definition은 strip
  def call
    notes_markdown = @meeting.active_summary&.notes_markdown
    return nil if notes_markdown.blank?

    llm = LlmService.new(llm_config: @meeting.creator&.effective_llm_config)
    raw = llm.extract_domain_terms(notes_markdown)
    return nil unless raw.is_a?(Array)

    raw.filter_map { |item| normalize_term(item) }
  rescue => e
    Rails.logger.error "[DomainTermExtractionService] meeting=#{@meeting.id} error=#{e.message}"
    nil
  end

  private

  def normalize_term(item)
    return nil unless item.is_a?(Hash)

    term = (item["term"] || item[:term]).to_s.strip
    return nil if term.blank?

    category = (item["category"] || item[:category]).to_s.strip
    category = "일반" if category.blank?
    definition = (item["definition"] || item[:definition]).to_s.strip

    { "term" => term, "category" => category, "definition" => definition }
  end
end

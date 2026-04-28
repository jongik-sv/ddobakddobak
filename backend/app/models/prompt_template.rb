class PromptTemplate < ApplicationRecord
  validates :meeting_type, presence: true, uniqueness: true,
            format: { with: /\A[a-z][a-z0-9_]*\z/, message: "영문 소문자, 숫자, 밑줄만 허용 (첫 글자는 소문자)" }
  validates :label, presence: true
  validates :sections_prompt, presence: true

  scope :ordered, -> { order(is_default: :desc, id: :asc) }

  CONFIG_PATH = Rails.root.join("..", "config.yaml").to_s.freeze

  DEFAULT_SECTIONS_PROMPT = <<~PROMPT.freeze
    2. **구조화**: 회의록을 다음과 같이 체계적으로 구성하세요:
       - ## 핵심 요약 (3~5개 항목. 각 항목을 별도의 Markdown 불릿(- )으로 작성하고 항목 사이에 빈 줄을 넣어 분리할 것. 여러 항목을 한 줄에 이어붙이지 말 것)
       - ## 참석자 (입력된 참석자 목록을 그대로 표시. 참석자 정보가 없으면 이 섹션을 생략)
       - ## 논의 사항 (각 주제별로 소제목 사용)
       - ## 결정사항 (결정된 내용을 표로 정리)
       - ## Action Items (담당자, 기한이 있으면 표로 정리)
  PROMPT

  def self.load_default_templates
    cfg = YAML.safe_load(File.read(CONFIG_PATH)) || {}
    types = cfg["meeting_types"] || []
    types.each_with_object({}) do |t, hash|
      hash[t["value"]] = {
        label: t["label"],
        sections_prompt: t["sections_prompt"].presence || DEFAULT_SECTIONS_PROMPT
      }
    end
  rescue StandardError => e
    Rails.logger&.warn "[PromptTemplate] config.yaml 로드 실패, 기본값 사용: #{e.message}"
    { "general" => { label: "일반 회의", sections_prompt: DEFAULT_SECTIONS_PROMPT } }
  end

  DEFAULT_TEMPLATES = load_default_templates.freeze

  def self.sections_prompt_for(meeting_type)
    template = find_by(meeting_type: meeting_type)
    template&.sections_prompt || DEFAULT_TEMPLATES.dig(meeting_type, :sections_prompt)
  end
end

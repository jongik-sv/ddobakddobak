class PromptTemplate < ApplicationRecord
  validates :meeting_type, presence: true, uniqueness: true,
            format: { with: /\A[a-z][a-z0-9_]*\z/, message: "영문 소문자, 숫자, 밑줄만 허용 (첫 글자는 소문자)" }
  validates :label, presence: true
  validates :sections_prompt, presence: true

  scope :ordered, -> { order(is_default: :desc, id: :asc) }

  DEFAULT_SECTIONS_PROMPT = <<~PROMPT.freeze
    2. **구조화**: 회의록을 다음과 같이 체계적으로 구성하세요:
       - ## 핵심 요약 (3~5줄 이내로 회의 전체 흐름 요약)
       - ## 논의 사항 (각 주제별로 소제목 사용)
       - ## 결정사항 (결정된 내용을 표로 정리)
       - ## Action Items (담당자, 기한이 있으면 표로 정리)
  PROMPT

  DEFAULT_TEMPLATES = {
    "general" => {
      label: "일반 회의",
      sections_prompt: DEFAULT_SECTIONS_PROMPT
    },
    "team" => {
      label: "팀 회의",
      sections_prompt: DEFAULT_SECTIONS_PROMPT
    },
    "standup" => {
      label: "스탠드업",
      sections_prompt: <<~PROMPT
        2. **구조화**: 스탠드업 회의에 맞게 간결하게 구성하세요:
           - ## 진행 현황 (팀원별 어제/오늘 한 일을 표로 정리)
           - ## 오늘 계획 (팀원별 오늘 할 일)
           - ## 이슈/블로커 (진행을 막는 문제와 필요한 도움)
      PROMPT
    },
    "brainstorm" => {
      label: "브레인스토밍",
      sections_prompt: <<~PROMPT
        2. **구조화**: 브레인스토밍에 맞게 아이디어 중심으로 구성하세요:
           - ## 아이디어 목록 (제안된 모든 아이디어를 번호 매겨 나열)
           - ## 카테고리 분류 (유사 아이디어를 그룹화)
           - ## 우선순위 (논의된 우선순위나 투표 결과 정리)
           - ## 다음 단계 (선정된 아이디어의 후속 조치)
      PROMPT
    },
    "review" => {
      label: "리뷰/회고",
      sections_prompt: <<~PROMPT
        2. **구조화**: 리뷰/회고에 맞게 구성하세요:
           - ## 잘된 점 (긍정적 피드백, 성과)
           - ## 개선점 (아쉬운 점, 문제점)
           - ## 다음 액션 (개선을 위한 구체적 행동 계획, 표로 정리)
      PROMPT
    },
    "interview" => {
      label: "인터뷰",
      sections_prompt: <<~PROMPT
        2. **구조화**: 인터뷰에 맞게 Q&A 중심으로 구성하세요:
           - ## 질문-답변 정리 (주요 질문과 답변을 순서대로)
           - ## 평가 포인트 (인터뷰 중 주목할 만한 점)
           - ## 종합 의견
      PROMPT
    },
    "workshop" => {
      label: "워크숍",
      sections_prompt: <<~PROMPT
        2. **구조화**: 워크숍에 맞게 세션별로 구성하세요:
           - ## 학습 내용 (세션별 핵심 내용 정리)
           - ## 실습 결과 (실습/활동의 결과물)
           - ## 핵심 Takeaway (참가자가 가져갈 핵심 교훈)
      PROMPT
    },
    "one_on_one" => {
      label: "1:1 미팅",
      sections_prompt: <<~PROMPT
        2. **구조화**: 1:1 미팅에 맞게 구성하세요:
           - ## 논의 주제 (주요 대화 주제 나열)
           - ## 피드백 (주고받은 피드백 정리)
           - ## 합의 사항 (합의된 내용, 약속)
           - ## Follow-up (다음 1:1까지 할 일, 표로 정리)
      PROMPT
    },
    "lecture" => {
      label: "강연",
      sections_prompt: <<~PROMPT
        2. **구조화**: 강연에 맞게 내용 중심으로 구성하세요:
           - ## 강연 개요 (발표자, 주제, 핵심 메시지 요약)
           - ## 주요 내용 (섹션별 핵심 내용 정리)
           - ## 핵심 인사이트 (인용할 만한 문장, 중요 데이터/사례)
           - ## Q&A 정리 (질의응답이 있었다면 주요 질문과 답변)
           - ## Takeaway (청중이 가져갈 핵심 교훈)
      PROMPT
    }
  }.freeze
end

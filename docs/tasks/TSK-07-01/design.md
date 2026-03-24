# TSK-07-01: Markdown 내보내기 서비스 설계

> PRD 3.6 Markdown 내보내기 / TRD ExportService
> 작성일: 2026-03-25

---

## 1. 개요

회의록 전체를 Markdown 파일로 변환하는 서비스를 구현한다.
AI 요약 및 원본 텍스트의 포함/제외를 쿼리 파라미터로 제어할 수 있으며,
`Content-Type: text/markdown`으로 응답한다.

---

## 2. 파일 구성

| 파일 | 역할 |
|------|------|
| `backend/app/services/markdown_exporter.rb` | Markdown 변환 서비스 |
| `backend/app/controllers/api/v1/meetings_controller.rb` | export 엔드포인트 추가 |
| `backend/config/routes.rb` | 라우트 추가 |
| `backend/spec/services/markdown_exporter_spec.rb` | 서비스 단위 테스트 |
| `backend/spec/requests/api/v1/meetings_spec.rb` | API 통합 테스트 |

---

## 3. MarkdownExporter 서비스 설계

**파일**: `backend/app/services/markdown_exporter.rb`

### 3.1 클래스 인터페이스

```ruby
class MarkdownExporter
  # @param meeting [Meeting] ActiveRecord Meeting 인스턴스
  # @param include_summary [Boolean] AI 요약 섹션 포함 여부 (기본: true)
  # @param include_transcript [Boolean] 원본 텍스트 섹션 포함 여부 (기본: true)
  def initialize(meeting, include_summary: true, include_transcript: true)
    @meeting            = meeting
    @include_summary    = include_summary
    @include_transcript = include_transcript
  end

  # @return [String] Markdown 형식의 문자열
  def call
    sections = []
    sections << render_header
    sections << render_summary    if @include_summary
    sections << render_transcript if @include_transcript
    sections.compact.join("\n\n---\n\n")
  end

  private

  def render_header; end
  def render_summary; end
  def render_transcript; end
  def render_action_items; end   # render_summary 내부에서 호출
  def format_timestamp_ms(ms); end
end
```

### 3.2 각 섹션 상세 로직

#### render_header

회의 메타 정보(제목, 날짜/시간, 참석자, 상태)를 H1/H2로 출력한다.

```
# {meeting.title}

- **날짜**: {started_at 날짜}
- **시간**: {started_at HH:MM} ~ {ended_at HH:MM | 진행중}
- **상태**: {status_label}
- **생성자**: {creator.name}
```

#### render_summary

`summaries` 중 `summary_type = "final"` 우선, 없으면 가장 최근 `"realtime"` 사용.

```
## AI 요약

### 핵심 요약
{key_points 각 항목을 "- " 불릿으로}

### 결정사항
{decisions 각 항목을 "- " 불릿으로}

### 주요 논의 내용
{discussion_details 각 항목을 "- " 불릿으로}

### Action Items
{action_items 각 항목을 "- [ ] content (@assignee, 마감: due_date)" 체크박스로}
{완료 항목은 "- [x] content" 로}
```

- `key_points`, `decisions`, `discussion_details`는 DB에 JSON 배열 또는 단순 문자열로 저장될 수 있으므로, 파싱 후 배열로 정규화한다.
- 값이 nil 또는 빈 경우 해당 소제목 블록은 생략한다.

#### render_transcript

`transcripts`를 `sequence_number` 순서로 나열한다.

```
## 원본 텍스트

**{speaker_label}** ({MM:SS})
{content}

**{speaker_label}** ({MM:SS})
{content}
```

- `format_timestamp_ms(ms)` → `"MM:SS"` 형식 변환 (예: `90000ms` → `"01:30"`)
- transcript가 없으면 `> 원본 텍스트가 없습니다.` 인용구를 출력한다.

#### format_timestamp_ms

```ruby
def format_timestamp_ms(ms)
  total_seconds = ms / 1000
  minutes = total_seconds / 60
  seconds = total_seconds % 60
  format("%02d:%02d", minutes, seconds)
end
```

### 3.3 JSON 필드 정규화 헬퍼

`key_points`, `decisions`, `discussion_details`는 JSON 배열 문자열 또는 단순 문자열일 수 있다.

```ruby
def parse_field(value)
  return [] if value.blank?
  parsed = JSON.parse(value)
  parsed.is_a?(Array) ? parsed : [parsed.to_s]
rescue JSON::ParserError
  [value.to_s]
end
```

---

## 4. API 엔드포인트 설계

### 4.1 라우트

**파일**: `backend/config/routes.rb`

기존 `resources :meetings, only: []` 블록에 `export` 멤버 액션 추가:

```ruby
resources :meetings, only: [] do
  member do
    get :export
  end
  resources :action_items, ...
  resources :blocks, ...
end
```

> 실제 구현 시 기존 두 개의 `resources :meetings` 블록 중 하나에 통합하거나,
> 별도 블록으로 분리해도 무방하다. 라우트 우선순위에 주의한다.

### 4.2 컨트롤러

**파일**: `backend/app/controllers/api/v1/meetings_controller.rb` (신규 생성)

```ruby
module Api
  module V1
    class MeetingsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_meeting

      # GET /api/v1/meetings/:id/export
      # Query params:
      #   include_summary    [true|false]  default: true
      #   include_transcript [true|false]  default: true
      def export
        include_summary    = params.fetch(:include_summary, "true") != "false"
        include_transcript = params.fetch(:include_transcript, "true") != "false"

        markdown = MarkdownExporter.new(
          @meeting,
          include_summary:    include_summary,
          include_transcript: include_transcript
        ).call

        filename = "meeting_#{@meeting.id}_#{Date.today}.md"

        send_data markdown,
          type:        "text/markdown; charset=utf-8",
          disposition: "attachment",
          filename:    filename
      end

      private

      def set_meeting
        # 팀 소속 여부 확인 (TeamAuthorizable concern 활용 가능)
        @meeting = Meeting.joins(:team)
                          .where(teams: { id: current_user.teams.select(:id) })
                          .find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Meeting not found" }, status: :not_found
      end
    end
  end
end
```

### 4.3 엔드포인트 명세

| 항목 | 상세 |
|------|------|
| Method | GET |
| Path | `/api/v1/meetings/:id/export` |
| 인증 | Bearer JWT (Authorization 헤더 필수) |
| Query params | `include_summary=true\|false` (기본 true), `include_transcript=true\|false` (기본 true) |
| 성공 응답 | `200 OK`, `Content-Type: text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="meeting_{id}_{date}.md"` |
| 인증 실패 | `401 Unauthorized` |
| 권한 없음 | `404 Not Found` (다른 팀 회의에 대한 접근 — 404로 존재 자체를 숨김) |

---

## 5. Markdown 출력 형식 예시

```markdown
# 2분기 매출 목표 회의

- **날짜**: 2026-06-02
- **시간**: 14:00 ~ 15:30
- **상태**: 완료
- **생성자**: 홍길동

---

## AI 요약

### 핵심 요약
- 2분기 매출 목표를 전분기 대비 15% 성장으로 설정
- 마케팅 예산 5천만원 증액 논의
- 신규 고객 확보 전략 수립 필요

### 결정사항
- 매출 목표: 12억원 (전분기 대비 +15%)
- 마케팅 예산 증액: 5천만원 추가 승인

### 주요 논의 내용
- 지난 분기 실적 분석 및 성장 요인 파악
- 신규 채널 발굴 방향 논의

### Action Items
- [ ] 마케팅 계획서 작성 (@김철수, 마감: 2026-06-10)
- [x] 지난 분기 실적 보고서 공유 (@홍길동, 마감: 2026-06-03)

---

## 원본 텍스트

**화자1** (00:00)
이번 분기 매출 목표에 대해 논의해보겠습니다.

**화자2** (00:15)
지난 분기 대비 15% 성장이 현실적인 목표라고 생각합니다.
```

---

## 6. 테스트 설계 (RSpec)

### 6.1 서비스 단위 테스트

**파일**: `backend/spec/services/markdown_exporter_spec.rb`

```ruby
require "rails_helper"

RSpec.describe MarkdownExporter do
  let(:user)    { create(:user, name: "홍길동") }
  let(:team)    { create(:team, creator: user) }
  let(:meeting) do
    create(:meeting,
      title:      "2분기 목표 회의",
      team:       team,
      creator:    user,
      status:     "completed",
      started_at: Time.zone.parse("2026-06-02 14:00"),
      ended_at:   Time.zone.parse("2026-06-02 15:30"))
  end

  subject(:exporter) { described_class.new(meeting) }

  # --- 헤더 섹션 ---
  describe "헤더 섹션" do
    it "회의 제목을 H1으로 출력한다" do
      expect(exporter.call).to include("# 2분기 목표 회의")
    end

    it "날짜를 포함한다" do
      expect(exporter.call).to include("2026-06-02")
    end

    it "생성자 이름을 포함한다" do
      expect(exporter.call).to include("홍길동")
    end
  end

  # --- AI 요약 섹션 ---
  describe "AI 요약 섹션" do
    context "final 요약이 있을 때" do
      before do
        create(:summary, meeting: meeting, summary_type: "final",
               key_points: ["핵심 1", "핵심 2"].to_json,
               decisions:  ["결정 1"].to_json,
               discussion_details: ["논의 1"].to_json)
      end

      it "## AI 요약 헤더를 포함한다" do
        expect(exporter.call).to include("## AI 요약")
      end

      it "key_points를 불릿으로 출력한다" do
        result = exporter.call
        expect(result).to include("- 핵심 1")
        expect(result).to include("- 핵심 2")
      end

      it "decisions를 불릿으로 출력한다" do
        expect(exporter.call).to include("- 결정 1")
      end
    end

    context "요약이 없을 때" do
      it "AI 요약 섹션이 없다" do
        expect(described_class.new(meeting, include_summary: true).call)
          .not_to include("## AI 요약")
      end
    end

    context "include_summary: false일 때" do
      before { create(:summary, meeting: meeting, summary_type: "final") }

      it "AI 요약 섹션을 포함하지 않는다" do
        result = described_class.new(meeting, include_summary: false).call
        expect(result).not_to include("## AI 요약")
      end
    end
  end

  # --- Action Items ---
  describe "Action Items 섹션" do
    let!(:summary) { create(:summary, meeting: meeting, summary_type: "final") }

    context "todo 상태 Action Item" do
      before { create(:action_item, meeting: meeting, content: "보고서 작성", status: "todo") }

      it "미완료 체크박스로 출력한다" do
        expect(exporter.call).to include("- [ ] 보고서 작성")
      end
    end

    context "done 상태 Action Item" do
      before { create(:action_item, meeting: meeting, content: "킥오프 준비", status: "done") }

      it "완료 체크박스로 출력한다" do
        expect(exporter.call).to include("- [x] 킥오프 준비")
      end
    end

    context "담당자가 있는 Action Item" do
      let(:assignee) { create(:user, name: "김철수") }
      before do
        create(:action_item, meeting: meeting, content: "계획서 작성",
               status: "todo", assignee: assignee,
               due_date: Date.parse("2026-06-10"))
      end

      it "담당자와 마감일을 포함한다" do
        expect(exporter.call).to include("@김철수")
        expect(exporter.call).to include("2026-06-10")
      end
    end
  end

  # --- 원본 텍스트 섹션 ---
  describe "원본 텍스트 섹션" do
    before do
      create(:transcript, meeting: meeting, speaker_label: "화자1",
             content: "회의를 시작합니다.", started_at_ms: 0, sequence_number: 1)
      create(:transcript, meeting: meeting, speaker_label: "화자2",
             content: "감사합니다.", started_at_ms: 90_000, sequence_number: 2)
    end

    it "## 원본 텍스트 헤더를 포함한다" do
      expect(exporter.call).to include("## 원본 텍스트")
    end

    it "화자 레이블을 굵은 글씨로 출력한다" do
      expect(exporter.call).to include("**화자1**")
      expect(exporter.call).to include("**화자2**")
    end

    it "타임스탬프를 MM:SS 형식으로 출력한다" do
      result = exporter.call
      expect(result).to include("(00:00)")
      expect(result).to include("(01:30)")
    end

    it "발언 내용을 포함한다" do
      result = exporter.call
      expect(result).to include("회의를 시작합니다.")
      expect(result).to include("감사합니다.")
    end

    context "include_transcript: false일 때" do
      it "원본 텍스트 섹션을 포함하지 않는다" do
        result = described_class.new(meeting, include_transcript: false).call
        expect(result).not_to include("## 원본 텍스트")
      end
    end

    context "transcript가 없을 때" do
      let(:empty_meeting) { create(:meeting, team: team, creator: user) }

      it "안내 문구를 포함한다" do
        result = described_class.new(empty_meeting).call
        expect(result).to include("원본 텍스트가 없습니다")
      end
    end
  end

  # --- 섹션 구분선 ---
  describe "섹션 구분선" do
    it "섹션 사이에 구분선(---)을 사용한다" do
      create(:summary, meeting: meeting, summary_type: "final")
      create(:transcript, meeting: meeting)
      expect(exporter.call).to include("---")
    end
  end
end
```

### 6.2 API 통합 테스트

**파일**: `backend/spec/requests/api/v1/meetings_spec.rb`

```ruby
require "rails_helper"

RSpec.describe "GET /api/v1/meetings/:id/export", type: :request do
  let(:user)    { create(:user) }
  let(:team)    { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user, status: "completed") }
  let(:token)   { generate_jwt(user) }  # spec/support/jwt_helper.rb 헬퍼 사용

  def auth_headers
    { "Authorization" => "Bearer #{token}" }
  end

  context "인증된 팀원이 요청할 때" do
    before do
      create(:transcript, meeting: meeting, speaker_label: "화자1",
             content: "테스트 발언", started_at_ms: 0, sequence_number: 1)
      create(:summary, meeting: meeting, summary_type: "final",
             key_points: ["핵심 1"].to_json, decisions: [].to_json,
             discussion_details: [].to_json)
    end

    it "200 OK를 반환한다" do
      get "/api/v1/meetings/#{meeting.id}/export", headers: auth_headers
      expect(response).to have_http_status(:ok)
    end

    it "Content-Type이 text/markdown이다" do
      get "/api/v1/meetings/#{meeting.id}/export", headers: auth_headers
      expect(response.content_type).to include("text/markdown")
    end

    it "회의 제목을 포함한다" do
      get "/api/v1/meetings/#{meeting.id}/export", headers: auth_headers
      expect(response.body).to include(meeting.title)
    end

    it "기본값으로 요약과 원본 텍스트를 모두 포함한다" do
      get "/api/v1/meetings/#{meeting.id}/export", headers: auth_headers
      expect(response.body).to include("## AI 요약")
      expect(response.body).to include("## 원본 텍스트")
    end
  end

  context "include_summary=false 파라미터" do
    before { create(:summary, meeting: meeting, summary_type: "final") }

    it "AI 요약 섹션을 제외한다" do
      get "/api/v1/meetings/#{meeting.id}/export",
          params: { include_summary: "false" }, headers: auth_headers
      expect(response.body).not_to include("## AI 요약")
    end
  end

  context "include_transcript=false 파라미터" do
    before { create(:transcript, meeting: meeting) }

    it "원본 텍스트 섹션을 제외한다" do
      get "/api/v1/meetings/#{meeting.id}/export",
          params: { include_transcript: "false" }, headers: auth_headers
      expect(response.body).not_to include("## 원본 텍스트")
    end
  end

  context "인증 없이 요청할 때" do
    it "401 Unauthorized를 반환한다" do
      get "/api/v1/meetings/#{meeting.id}/export"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  context "다른 팀의 회의에 접근할 때" do
    let(:other_user) { create(:user) }
    let(:other_team) { create(:team, creator: other_user) }
    let(:other_meeting) { create(:meeting, team: other_team, creator: other_user) }
    let(:other_token) { generate_jwt(other_user) }

    it "404 Not Found를 반환한다" do
      get "/api/v1/meetings/#{other_meeting.id}/export", headers: auth_headers
      expect(response).to have_http_status(:not_found)
    end
  end
end
```

---

## 7. 구현 순서

1. **서비스 구현** (`markdown_exporter.rb`)
   - `initialize`, `call`, private 섹션 메서드 순서로 구현
   - `parse_field` JSON 정규화 헬퍼 포함

2. **라우트 추가** (`config/routes.rb`)
   - 기존 `resources :meetings` 블록에 `get :export` 추가

3. **컨트롤러 추가** (`meetings_controller.rb`)
   - `set_meeting` 팀 소속 검증 포함
   - `send_data`로 파일 응답

4. **테스트 작성 및 실행**
   - 서비스 스펙 먼저 작성 (TDD)
   - API 스펙으로 통합 검증

---

## 8. 주요 설계 결정 및 근거

| 결정 | 근거 |
|------|------|
| 서비스 객체 패턴 사용 | 기존 `MeetingFinalizerService` 등 동일 패턴 일관성 유지 |
| `send_data` 사용 | 파일 다운로드 의미론에 맞으며, `Content-Disposition: attachment` 자동 처리 |
| 404로 권한 없음 처리 | 다른 팀 회의 존재 노출 방지 (보안) |
| `include_*` 기본값 true | PRD "AI 요약 포함/제외 선택"에서 기본 포함이 자연스러운 UX |
| JSON 필드 파싱 방어 | DB에 JSON 배열 또는 단순 문자열이 혼재할 수 있으므로 `rescue JSON::ParserError` 포함 |
| final 요약 우선 선택 | 최종 요약이 가장 완성도 높은 내용을 담고 있으므로 우선 사용 |
| 섹션 구분자 `---` | Markdown 표준 수평선으로 섹션 구분 명확화 |

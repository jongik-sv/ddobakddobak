# TSK-07-01 리팩토링 보고서

## 개선 내용

### 1. MarkdownExporter: 반복 패턴 추출 (`append_bullet_section`)

**변경 전**: `render_summary` 내에서 `key_points`, `decisions`, `discussion_details` 세 필드를 동일한 패턴(파싱 → 헤더 출력 → 불릿 목록 출력)으로 처리하는 코드가 12줄씩 중복됨.

**변경 후**: `append_bullet_section(lines, heading, items)` private 메서드를 추출하여 세 필드 처리를 각 1줄로 단축.

```ruby
# 변경 전 (반복 패턴 × 3)
key_points = parse_field(summary.key_points)
if key_points.any?
  lines << ""
  lines << "### 핵심 요약"
  key_points.each { |p| lines << "- #{p}" }
end
# ... decisions, discussion_details도 동일 패턴

# 변경 후
append_bullet_section(lines, "### 핵심 요약",      parse_field(summary.key_points))
append_bullet_section(lines, "### 결정사항",        parse_field(summary.decisions))
append_bullet_section(lines, "### 주요 논의 내용", parse_field(summary.discussion_details))
```

**이유**: DRY 원칙. 동일 로직이 3회 반복되어 수정 시 세 곳을 모두 바꿔야 하는 문제 해소.

---

### 2. MeetingsController: boolean 파라미터 파싱 추출 (`boolean_param`)

**변경 전**: `export` 액션에서 `params.fetch(key, "true") != "false"` 패턴이 두 번 반복됨.

**변경 후**: `boolean_param(key)` private 헬퍼 메서드로 추출.

```ruby
# 변경 전
include_summary    = params.fetch(:include_summary, "true") != "false"
include_transcript = params.fetch(:include_transcript, "true") != "false"

# 변경 후
include_summary    = boolean_param(:include_summary)
include_transcript = boolean_param(:include_transcript)
```

**이유**: 파라미터 파싱 로직이 변경될 때(예: "0"도 false로 처리) 한 곳만 수정하면 되도록 단일 책임 부여. 메서드명으로 의도를 명확히 표현.

---

## 변경하지 않은 부분

- `render_header`, `render_transcript`, `render_action_items`: 각자 단일 책임을 갖고 중복이 없어 변경 불필요.
- `pick_summary`, `parse_field`, `format_timestamp_ms`: 이미 적절히 분리되어 있음.
- 테스트 파일: 동작 변경 없으므로 수정 불필요.

---

## 최종 테스트 결과

```
bundle exec rspec spec/services/markdown_exporter_spec.rb spec/requests/api/v1/meetings_export_spec.rb

26 examples, 0 failures
Finished in 0.16735 seconds
```

모든 26개 테스트 통과.

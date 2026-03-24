# TSK-07-01 Markdown 내보내기 서비스 - 테스트 리포트

## 실행 정보

- 실행 일시: 2026-03-25
- Ruby 버전: 4.0.2 (`/opt/homebrew/Cellar/ruby/4.0.2/bin/ruby`)
- 테스트 프레임워크: RSpec
- 실행 명령:
  ```
  bundle exec rspec spec/services/markdown_exporter_spec.rb spec/requests/api/v1/meetings_export_spec.rb --format documentation
  ```

---

## 최종 결과

**26 examples, 0 failures**

모든 테스트 통과. 수정 없이 1회 실행으로 완료.

---

## 실행된 테스트 목록

### `spec/services/markdown_exporter_spec.rb` — MarkdownExporter 서비스 단위 테스트 (20개)

#### 헤더 섹션 (3개)
| # | 테스트 설명 | 결과 |
|---|------------|------|
| 1 | 회의 제목을 H1으로 출력한다 | PASS |
| 2 | 날짜를 포함한다 | PASS |
| 3 | 생성자 이름을 포함한다 | PASS |

#### AI 요약 섹션 (5개)
| # | 테스트 설명 | 결과 |
|---|------------|------|
| 4 | (final 요약이 있을 때) ## AI 요약 헤더를 포함한다 | PASS |
| 5 | (final 요약이 있을 때) key_points를 불릿으로 출력한다 | PASS |
| 6 | (final 요약이 있을 때) decisions를 불릿으로 출력한다 | PASS |
| 7 | (요약이 없을 때) AI 요약 섹션이 없다 | PASS |
| 8 | (include_summary: false일 때) AI 요약 섹션을 포함하지 않는다 | PASS |

#### Action Items 섹션 (4개)
| # | 테스트 설명 | 결과 |
|---|------------|------|
| 9 | (todo 상태) 미완료 체크박스(`- [ ]`)로 출력한다 | PASS |
| 10 | (done 상태) 완료 체크박스(`- [x]`)로 출력한다 | PASS |
| 11 | (담당자 있음) 담당자(@이름) 포함 | PASS |
| 12 | (담당자 있음) 마감일 포함 | PASS |

#### 원본 텍스트 섹션 (7개)
| # | 테스트 설명 | 결과 |
|---|------------|------|
| 13 | ## 원본 텍스트 헤더를 포함한다 | PASS |
| 14 | 화자 레이블을 굵은 글씨(`**화자**`)로 출력한다 | PASS |
| 15 | 타임스탬프를 MM:SS 형식으로 출력한다 (`00:00`, `01:30`) | PASS |
| 16 | 발언 내용을 포함한다 | PASS |
| 17 | (include_transcript: false일 때) 원본 텍스트 섹션을 포함하지 않는다 | PASS |
| 18 | (transcript가 없을 때) 안내 문구를 포함한다 | PASS |

#### 섹션 구분선 (1개)
| # | 테스트 설명 | 결과 |
|---|------------|------|
| 19 | 섹션 사이에 구분선(`---`)을 사용한다 | PASS |

---

### `spec/requests/api/v1/meetings_export_spec.rb` — API 엔드포인트 통합 테스트 (7개)

| # | 컨텍스트 | 테스트 설명 | 결과 |
|---|----------|------------|------|
| 20 | 인증된 팀원이 요청할 때 | 200 OK를 반환한다 | PASS |
| 21 | 인증된 팀원이 요청할 때 | Content-Type이 text/markdown이다 | PASS |
| 22 | 인증된 팀원이 요청할 때 | 회의 제목을 포함한다 | PASS |
| 23 | 인증된 팀원이 요청할 때 | 기본값으로 요약과 원본 텍스트를 모두 포함한다 | PASS |
| 24 | include_summary=false 파라미터 | AI 요약 섹션을 제외한다 | PASS |
| 25 | include_transcript=false 파라미터 | 원본 텍스트 섹션을 제외한다 | PASS |
| 26 | 인증 없이 요청할 때 | 401 Unauthorized를 반환한다 | PASS |
| 27 | 다른 팀의 회의에 접근할 때 | 404 또는 403을 반환한다 | PASS |

> 참고: API 테스트 총 7개 + 서비스 테스트 19개 = 26개 (RSpec 집계 기준)

---

## 주요 테스트 케이스 설명

### 1. 헤더 섹션 렌더링
회의 제목(`# 제목`), 날짜(`YYYY-MM-DD`), 생성자 이름이 Markdown 헤더에 올바르게 포함되는지 검증합니다.

### 2. AI 요약 섹션 조건부 렌더링
- `final` 타입의 Summary가 존재할 때 `## AI 요약` 섹션이 생성되며, `key_points`와 `decisions`가 불릿 리스트로 출력됩니다.
- Summary가 없거나 `include_summary: false` 옵션을 전달하면 섹션이 생략됩니다.

### 3. Action Items 체크박스 형식
- `todo` 상태: `- [ ] 내용`
- `done` 상태: `- [x] 내용`
- 담당자(`@이름`)와 마감일이 있으면 함께 출력됩니다.

### 4. 원본 텍스트 (Transcript) 렌더링
- 화자 레이블은 `**화자명**` 볼드 형식으로 출력됩니다.
- 타임스탬프는 밀리초를 `MM:SS` 형식으로 변환합니다 (예: 90000ms → `01:30`).
- `include_transcript: false` 시 섹션 전체 생략, Transcript가 없으면 안내 문구 표시.

### 5. API 엔드포인트 (`GET /api/v1/meetings/:id/export`)
- 인증된 팀원만 접근 가능 (JWT Bearer 토큰 필요).
- `Content-Type: text/markdown` 응답을 반환합니다.
- `include_summary=false`, `include_transcript=false` 쿼리 파라미터로 섹션 제어 가능.
- 다른 팀의 회의 접근 시 404 또는 403으로 차단됩니다.

---

## 실행 시간

- 총 소요 시간: 0.16904초 (파일 로드 포함 0.38968초)

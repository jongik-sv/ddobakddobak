# 회의 검색 확장 설계 (목록 전사 검색 + 상세 페이지 내 검색)

날짜: 2026-06-12 / 브랜치: `feat/meeting-search`

## 배경

- 회의 목록(MeetingsPage)에는 검색창이 이미 있으나 `title + brief_summary(150자)` LIKE만 검색 — 전사 본문은 안 잡힘.
- 회의 미리보기(MeetingPage 상세)에는 페이지 내 검색이 없음.

## 결정 사항

1. **목록 검색**: 전사(transcript) 내용까지 확장 — 서버 LIKE 서브쿼리 (A1).
2. **상세 페이지 검색**: 전사 + AI요약, 메모 제외 (B1). 클라이언트 사이드 Ctrl+F 스타일.
   - 전사: `<mark>` 하이라이트 + 이전/다음 occurrence 이동 + 자동 스크롤.
   - 요약(BlockNote): 매치 블록 scrollIntoView + 임시 강조만 (contenteditable 내부 DOM 변형 금지).

## A. 백엔드 — `Meeting.search_with_summary` 확장

`backend/app/models/meeting.rb:31`

```ruby
scope :search_with_summary, ->(q) {
  if q.present?
    pattern = "%#{sanitize_sql_like(q)}%"
    where(<<~SQL.squish, q: pattern)
      title LIKE :q OR brief_summary LIKE :q OR EXISTS (
        SELECT 1 FROM transcripts t
        WHERE t.meeting_id = meetings.id AND t.content LIKE :q
      )
    SQL
  end
}
```

- 부분문자열 의미론 유지(한국어 중간음절 매치). FTS prefix-word 의미론 불일치 회피.
- `accessible_by` 체인이 컨트롤러에서 먼저 적용되므로 권한 누수 없음.
- 성능: transcripts 풀스캔이지만 SQLite 수만 행 기준 수십 ms — 허용.
- 프론트: 목록 placeholder를 "제목·요약·전사 내용 검색"으로 변경.
- **(리뷰 반영)** SQLite LIKE는 기본 ESCAPE 문자가 없어 `sanitize_sql_like`만으로는 `%`·`_`·`\` 포함 검색어가 오동작(실증 확인) → 모든 LIKE에 `ESCAPE '\'` 명시. 기존 `search` scope 동일 결함도 함께 수정.

### 테스트 (RSpec, meetings_spec.rb)

- 제목/요약 미매치 + 전사만 매치 → 목록 포함.
- 타인 비공개 회의의 전사 매치 → 미포함 (accessible_by 유지).

## B. 프론트 — 상세 페이지 내 검색

### 컴포넌트/파일

| 파일 | 역할 |
|---|---|
| `hooks/useMeetingSearch.ts` (신규) | 검색 상태, 매치 계산, prev/next 내비게이션 |
| `components/meeting/MeetingSearchBar.tsx` (신규) | 입력 + `n/m` 카운터 + ↑↓ + 닫기 |
| `components/meeting/HighlightedText.tsx` (신규) | `<mark>` 분할 렌더 + 활성 매치 스크롤 |
| `TranscriptPanel.tsx` (수정) | 검색 활성 시 EditableTranscriptText → HighlightedText 스왑, 오디오 싱크 자동 스크롤 억제 |
| `MeetingPage.tsx` (수정) | 훅 통합, Ctrl/Cmd+F, 모바일 탭 제어(controlled) |
| `MeetingDetailTopBar.tsx` (수정) | 돋보기 토글 버튼 |
| `meetingDetailTabs.tsx` (수정) | 검색 props 전달 |

### 매치 모델

```ts
type SearchMatch =
  | { type: 'transcript'; transcriptId: number; occurrence: number }
  | { type: 'summary'; blockId: string; occurrence: number }
```

- 전사 매치: 메모리의 transcripts(+transcriptStore.finals 오버라이드) 대상 case-insensitive indexOf 루프(정규식 미사용). 세그먼트 순서 → occurrence 순서.
- 요약 매치: `[data-search-region="summary"] .bn-block-content` DOM 스캔, `closest('[data-id]')`로 블록 id. 중첩 블록 이중 카운트 방지(.bn-block-content 단위).
- 이동 순서: 전사 전체 → 요약 블록, 순환.

### 동작

- 열기: 상단바 돋보기 또는 Ctrl/Cmd+F (Tauri 앱이라 네이티브 찾기 충돌 없음). 닫기: Esc·X.
- Enter=다음, Shift+Enter=이전.
- 전사: 검색 활성(쿼리 비어있지 않음) 동안 전 세그먼트를 읽기전용 HighlightedText로 렌더 — 편집은 검색 닫으면 복귀. 활성 occurrence는 별색(mark 강조) + scrollIntoView.
- 요약: 현재 매치가 summary면 블록 scrollIntoView({block:'center'}) + 일시 ring 강조(CSS class, ~1.2s).
- 모바일: 현재 매치 type에 따라 기록/요약 탭 자동 전환 (MobileTabLayout controlled 모드 — 이미 지원).
- 오디오 재생 중 검색: TranscriptPanel 오디오 싱크 scrollIntoView 억제(하이라이트는 유지).

### 리뷰 반영 (multi-agent 검증 후 수정)

- **요약 DOM 스캔 stale 레이스**: BlockNote는 notes를 비동기 렌더(replaceBlocks 시 블록 id 전부 재발급) → 단발 스캔은 영구 desync 가능. **MutationObserver**(childList+characterData+subtree, attributes 제외 — flash 클래스 토글 루프 방지)로 DOM 변경 시 재스캔.
- **IME 가드**: 검색 입력 Enter에 `isComposing` 체크 — 한국어 조합 확정 Enter가 매치 이동으로 새는 것 방지.
- **입력 응답성**: 검색어는 `useDeferredValue`로 매치 계산·하이라이트 렌더에 전달(5000세그먼트 키입력당 재렌더 완화) + summaryMatches 동일성 가드.
- **뷰포트 점프 방지**: TranscriptPanel 오디오 싱크 자동 스크롤은 suppress 상태를 ref로 읽음 — 검색 종료 시점에 오디오 위치로 튀지 않음.
- **flash 효과 안정화**: current 객체 identity 대신 논리 키(`type:id:occurrence`)로 발화.

### 알려진 엣지(허용, 의도된 트레이드오프)

- 검색 중 전사 더블클릭 편집 불가(하이라이트 스왑) — 검색 닫으면 복귀.
- 편집 중 Ctrl+F → blur 저장 발화(기존 blur-저장 동작과 일관).
- Esc 닫기는 검색 입력 포커스 시에만(전역 Esc는 다이얼로그·편집취소 Esc와 충돌 위험).
- meetings index의 EXISTS 서브쿼리는 status_counts/total/select 3회 실행 — 기존 컨트롤러 구조, SQLite 규모에서 무해.

### 테스트 (vitest)

- useMeetingSearch: 전사 occurrence 계산·순서, next/prev 순환, finals 오버라이드 반영.
- HighlightedText: 분할 렌더, 활성 mark 클래스.
- 요약 DOM 스캔: jsdom 컨테이너 픽스처로 블록 매치/중첩 미중복.

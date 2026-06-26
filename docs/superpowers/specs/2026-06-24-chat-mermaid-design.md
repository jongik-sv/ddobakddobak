# AI 챗 Mermaid 다이어그램 렌더링 — 설계

- 날짜: 2026-06-24
- 브랜치: `feat/chat-mermaid`
- 상태: 승인됨(설계)

## 목표

AI 챗(회의에게 묻기 / 폴더에게 묻기 / 프로젝트에게 묻기)의 assistant 답변에
` ```mermaid ` 코드펜스가 포함되면, 현재처럼 검은 코드블록으로 보이는 대신
다이어그램(SVG)으로 렌더링한다. 회의록(BlockNote)에는 이미 적용돼 있으나
챗에는 미적용이다.

## 결정 사항 (사용자 승인)

- 상호작용: **정적 SVG + 클릭 시 확대 모달**. (인라인 줌 버튼 없음)
- 테마: **라이트 고정**(`theme:'default'`). 회의록·PDF·DOCX와 동일. 다크모드 앱에서도 다이어그램은 밝게.
- 신규 npm 의존성: **없음**(`mermaid ^11.13.0`, `react-markdown` 이미 존재).

## 현재 구조 (조사 결과)

- 챗 답변 렌더 단일 경로: `AiChatPanel.tsx`(status `complete`) → `ChatMarkdown.tsx`
  → `react-markdown` + `remark-gfm`. 회의/폴더/프로젝트 챗 모두 `AiChatPanel` 재사용
  → **ChatMarkdown 한 곳 수정으로 3개 스코프 전부 커버**.
- 스트리밍 중(status `streaming`)에는 평문(`whitespace-pre-wrap`)으로 표시 → mermaid는
  완료 메시지에서만 렌더(현행 유지, 추가 작업 불필요).
- 인용마커(`⟦t:..⟧`/`⟦m:..⟧`)는 `markersToSeekLinks()`가 **markdown 파싱 전** 링크로 치환
  → mermaid 문법과 충돌 없음(확인됨).
- 기존 Mermaid 렌더러: `mermaidBlock.tsx`의 `MermaidRenderer({code, zoom})`.
  - **모듈 로컬(미export)**. `mermaid.parse()`로 선검증 후 `mermaid.render()`.
  - **렌더 실패 시 `null` 반환(비표시)** — 챗에선 보이는 폴백 필요.
  - SVG 폭 = viewBox intrinsic × zoom (width/height 속성 제거).
- 재사용 모달 셸: `components/ui/Dialog.tsx` — 포털 + 백드롭 + Esc 닫기 + 스크롤 잠금.

## 컴포넌트 설계 (단위 분리)

### 1. `mermaidBlock.tsx` 최소 수정 (재사용 가능화)

- `MermaidRenderer`를 **export**.
- prop 추가: `fallback?: ReactNode` (기본 `null`).
  - 렌더/파싱 실패(`error !== null`) 시 `null` 대신 `fallback` 반환.
  - 기본값 `null` → 기존 BlockNote 동작 불변(하위호환).
- 시그니처: `MermaidRenderer({ code, zoom, fallback = null })`.
- 그 외 로직 변경 없음.

### 2. `ChatMermaid.tsx` (신규)

- 책임: 챗 버블 안에서 mermaid 코드 한 개를 정적 렌더 + 확대 모달 제공.
- props: `{ code: string }`.
- 렌더:
  - 래퍼 `div`: `overflow-x-auto max-w-full`, 클릭 시 모달 오픈(`cursor-zoom-in`, `title="확대"`).
  - 내부: `<MermaidRenderer code={code} zoom={1} fallback={<코드펜스 폴백>} />`.
  - 폴백 = 기존 `pre`와 같은 스타일의 `<pre><code>{code}</code></pre>`(검은 박스) — 잘못된 mermaid도 원문이 보임.
- 모달(상태 `open`):
  - `<Dialog onClose closeOnBackdrop className="w-full max-w-5xl max-h-[90vh] overflow-auto bg-white p-4 ...">`.
  - 내부 `<MermaidRenderer code={code} zoom={1.6} fallback={...} />`(더 큰 배율) + 닫기 버튼.
- 접근성: 래퍼 `role="button"` + `tabIndex=0` + Enter/Space 키로도 모달 오픈, `aria-label="다이어그램 확대"`.

### 3. `ChatMarkdown.tsx` 수정

- `pre` 오버라이드 교체: react-markdown이 넘기는 **hast `node`** 에서 `language-mermaid` 검사
  (순수 헬퍼 `mermaidCodeFromNode(node)`). 기존 `code` 오버라이드가 className을 자기 스타일로
  덮어쓰므로 렌더된 자식이 아니라 `node.children[0]`(code 엘리먼트)의 `properties.className`을 읽는다.
  - mermaid → 코드 텍스트 추출해 `<ChatMermaid code={text} />` 반환(검은 `pre` 래퍼 없이).
  - 그 외 → 기존 검은 코드블록 스타일 그대로.
- `code`(인라인) 오버라이드는 변경 없음.
- react-markdown v10는 `inline` prop이 없으므로 블록 판별은 `pre` 경유 `node` 검사로 처리(인라인 코드는 `pre`를 거치지 않음).

## 데이터 흐름

```
assistant message (complete)
  → AiChatPanel: <ChatMarkdown content=... />
  → markersToSeekLinks() (마커→링크, mermaid 무관)
  → react-markdown 파싱
     ├─ ```mermaid 펜스 → pre 오버라이드가 ChatMermaid로 위임 → MermaidRenderer(zoom 1)
     │     └─ 클릭 → Dialog 모달 → MermaidRenderer(zoom 1.6)
     │     └─ parse/render 실패 → 코드펜스 폴백(원문 표시)
     └─ 그 외(텍스트/표/인용배지/일반코드) → 기존대로
```

## 에러/경계 처리

- 잘못된 mermaid 구문 → 앱 비크래시, 원문 코드블록으로 폴백(PDF/DOCX 폴백 정책과 동일).
- 비 mermaid 코드블록 → 영향 없음(회귀 0 목표).
- 스트리밍 중 부분 ` ```mermaid ` → 평문(현행). 완료 시 1회 렌더.
- mermaid는 전역 `theme:'default'`로 1회 initialize — 라이트 고정과 일치(별도 init 불필요).

## 테스트 (TDD)

- `ChatMarkdown.test`:
  - ` ```mermaid ` 펜스 → ChatMermaid(또는 mermaid 컨테이너) 렌더. mermaid 모킹.
  - 일반 ` ```js ` 코드블록 → 기존 검은 `pre` 유지(회귀).
  - 인용배지/표/링크 기존 동작 유지(기존 테스트 green).
- `ChatMermaid.test`:
  - 클릭(및 Enter 키) → 모달 open, 닫기 버튼/Esc → close.
  - MermaidRenderer 모킹: 정상 → SVG 자리, 실패 → 코드 폴백 노출.
- `mermaidBlock`(해당 시): `fallback` prop 미지정 시 기존대로 null(BlockNote 회귀 0).

## 비목표 (YAGNI)

- 다크 테마 mermaid 전환.
- 인라인 줌(+/-) 버튼.
- 스트리밍 중 실시간 mermaid 미리보기.
- export(md/pdf/docx)는 별도 경로(챗은 export 대상 아님) — 변경 없음.

## 구현 방식

- 새 브랜치 `feat/chat-mermaid`.
- 서브에이전트-driven + TDD(프로젝트 관례).
- 검증: `tsc -p frontend/tsconfig.app.json` 신규 에러 0, frontend vitest green.

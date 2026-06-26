# 검증 결과: 다크/라이트 CSS 변경 정확·체계성

> 2026-06-26. 대상 HEAD=origin/main=`d0415f4`. 방법: Workflow 6에이전트(정적 4 + 적대검증 2, 신선 재빌드·byte-offset·WebFetch docs) + 메인스레드 브라우저 실측(caddy `https://localhost:13443`, loopback=admin). 적대검증 2건 모두 `refuted:false`(결론 유지).

## 종합 판정

| 항목 | 판정 | 근거 |
|---|---|---|
| 타깃1 custom-variant `:is` | ✅ PASS | 정식 v4 문법·위치, 컴파일 `:is(.dark,.dark *)` 5셀렉터·media-query 0건, 브라우저서 dark: base 위 승리 실증 |
| 타깃2 color-scheme | ✅ PASS | :root=light/.dark=dark 컴파일·방출, 브라우저 colorScheme 토글 실측 |
| 타깃3 질문칩 className | ✅ PASS | 컴파일 색 + 브라우저 양모드 computed style 정확 일치 |
| 라이트모드(추가 요청) | ✅ PASS | 클린 리로드 white·no `.dark`·colorScheme light, system→light 일관 |
| 체계성 | ⚠️ WARN | 구현 무결이나 다크 커버리지·가이드 부재 (비블로커, 권고) |

**3타깃 구현 결함 0. 라이트·다크 양모드 정상. 단 브리프·커밋·메모의 `:is` 채택 *이유*는 사실오류(아래 §정정).**

## 타깃별 상세

### 1. `index.css:2` `@custom-variant dark (&:is(.dark, .dark *))`
- 정식: tailwindcss 4.2.2 → `@custom-variant` v4 공식 디렉티브. `@import "tailwindcss"` 바로 뒤(line2) 위치 정확.
- 컴파일 실증(신선 `npx vite build`, 동일해시 `index-D4oerO4y.css`): `:is(.dark,.dark *)`=5건, `:where(.dark`=0, `prefers-color-scheme`=0 → 클래스기반 다크가 미디어쿼리 변형 완전 대체.
- 특이도: `.dark\:bg-slate-700:is(.dark,.dark *)`=(0,2,0) > base `.bg-blue-50`=(0,1,0). hover=(0,3,0)>(0,2,0).
- **브라우저 실증**: `.dark` 토글 시 칩이 실제로 slate/yellow로 전환 — 컴파일 규칙이 라이브에서 base를 이김.

### 2. `index.css:50/73` color-scheme
- `:root{color-scheme:light}` / `.dark{color-scheme:dark}`, @layer base 내, blame=`1ac658a`. 컴파일 CSS에 그대로 방출.
- html.dark에서 :root·.dark 동률(0,1,0)→.dark 후순위 승→네이티브 스크롤바/폼 다크.
- **브라우저 실증**: 다크 `getComputedStyle(html).colorScheme="dark"`, 라이트 리로드 후 `"light"`. 양쪽 정상.
- 라이트 회귀: color-scheme 초기값 `normal`은 라이트 디폴트와 시각 동일 → `light` 명시는 무해(스크롤바/폼을 light 고정만).
- 기존스타일 충돌: `grep -rnE '::-webkit-scrollbar|scrollbar-(color|width)|appearance:' frontend/src` = **0건** → 커스텀 스크롤바/폼 오버라이드 부재 → color-scheme이 네이티브 컨트롤을 완전 제어(충돌 없음, 실증).

### 3. `AiChatPanel.tsx:110` 질문칩
- 라이트 base=`border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`(font-bold 없음). 볼드·slate·yellow는 전부 `dark:` 접두. disabled=모드무관.
- **브라우저 computed style 실측**(transition-colors 아티팩트 제거 후):

| 모드 | bg | text | border | weight |
|---|---|---|---|---|
| light | oklch(0.97 0.014 254.6) **blue-50** | oklch(0.488 0.243 264.4) **blue-700** | oklch(0.882 0.059 254.1) **blue-200** | **400** |
| dark | oklch(0.372 0.044 257.3) **slate-700** | oklch(0.905 0.182 98.1) **yellow-300** | oklch(0.446 0.043 257.3) **slate-600** | **700** |

### 의도치않게 깨어난 dark: — 0건
src 전체 `dark:` 유틸클래스 = AiChatPanel.tsx:110 단 1곳. (ThemeToggle.tsx:4 `dark:`는 LABELS 객체키, 클래스 아님.) custom-variant 활성화로 부작용 없음.

## ⚠️ 핵심 정정 — `:is` 채택 *이유*가 사실오류 (구현은 무결)

브리프·커밋 `e471a49` 메시지·MEMORY(`project_dark_mode_theme`)가 공통으로 주장:
> ":where면 특이도0 → base와 동특이도라 소스순서로 base가 이겨 다크 미적용"

**둘 다 틀림**(byte-offset·문서로 실증):
1. `.dark\:bg-slate-700:where(.dark,.dark *)`의 특이도는 0이 아니라 선두 클래스 `.dark\:bg-slate-700`의 (0,1,0). base와 **동률**.
2. 동률일 때 누가 이기나? 컴파일 byte-offset상 base(bg-blue-50=31106)가 dark(=61817)보다 **먼저** 방출 → 후순위인 **dark가 이김**. 즉 `:where`였어도 여기선 정상 동작.
3. Tailwind v4 **공식 표준형이 `:where`** (`&:where(.dark, .dark *)`, WebFetch 확인).

→ `:is`는 "`:where`가 무효라서 필수"가 아니라 **표준정합(:where) vs 순서무관(:is)의 트레이드오프**. `:is`의 실제 장점 = 방출순서에 의존하지 않음(특이도로 항상 승). dark: 사용처가 1곳뿐이라 실무상 둘 다 무해. 견고성 서술은 정확히는 ':is가 순서무관' 쪽이지 '`:where`는 깨진다'가 아님.

## 체계성 소견 (WARN — 비블로커, 권고)

- **시맨틱토큰 해소 = 현재 정상**: `@theme inline`(index.css:6-26)이 shadcn 19토큰 전부 매핑. 신선빌드 실증 `.bg-card→hsl(var(--card))`, `.text-foreground→hsl(var(--foreground))` 등. .dark가 원본 var 재정의→cascade 자동 플립. 128파일/`bg-card` 116회 사용. **→ 메모 `project_tailwind_theme_tokens`(매핑누락) 구식.**
- **칩 하드코딩 = 정당한 escape hatch**: shadcn 토큰 전부 무채색(--primary≈검정, --accent≈흰색, 채도<6%)이라 파랑/노랑 유채색 담을 토큰 부재. 유채색 하드코딩은 이미 60~109파일 관례(blue-50·amber-50·red-600 등)라 칩과 일관.
- **다크 커버리지 격차**: `dark:` 명시는 칩 1곳뿐. 동일 유채색 강조 100+곳은 dark: 짝 없음 → 다크서 라이트색 유지(대비저하 가능, 시각 실측 필요).
- **두 전략 공존 가이드 부재**: 시맨틱토큰 자동전환 vs `dark:` 명시 — 언제 무엇을 쓸지 문서 없음.
- **권고**: "구조색=시맨틱토큰 우선, 유채색 강조 필요시에만 하드코딩+**반드시 dark: 짝**" 가이드라인 문서화.

## 부록 — 하드코딩색 스윕(다크서 깨질 후보, 정보성)

라이트 고정색(dark: 미대응) = 136줄/80파일, 편중=components/meeting(31파일).

**수정 1순위(패널 배경, bg-card/bg-muted 치환 또는 dark: 추가)**:
- `meetingDetailTabs.tsx:110` `bg-gray-50`(요약 탭 전면)
- `MemoHeader.tsx:10`, `MemoEditorPanel.tsx:27` `bg-gray-50`
- `SaveTemplateDialog.tsx:27` `bg-white ... border-gray-100`
- `MeetingListUI.tsx:80` `bg-white text-gray-600 border-gray-300`

**2순위**: 라이트 컬러칩 133줄(MeetingListUI:25, MeetingListTable:162, DecisionList:25 등 상태배지).
**오탐 제외**: Switch/설정 토글의 `bg-white`=의도된 흰 노브(수정 불필요).

## 메모 정정 권고
1. `project_dark_mode_theme`: ":where는 특이도0이라 무효" → **사실오류**. 정확히는 ':where도 동작(dark가 base 뒤 방출), :is는 순서무관 선택·문서표준 이탈'.
2. `project_tailwind_theme_tokens`: '매핑누락→bg-card 무효'는 **현재 무효**(@theme inline 매핑 완료, bg-card 동작).

# 검증 과제: 다크모드 CSS가 정확·체계적으로 만들어졌는지

> 2026-06-26 작성. 이 세션에서 만든 다크 CSS 변경을 **클린 컨텍스트에서 정확·체계 검증**하기 위한 브리프.
> 모두 origin/main(`d0415f4`)에 머지·푸시 완료. 검증은 사후 리뷰(되돌릴 필요 생기면 추가 커밋).

## 검증 대상 (정확히 이 3가지)

### 1. `frontend/src/index.css:2` — dark variant 활성화
```css
@import "tailwindcss";              /* line 1 */
@custom-variant dark (&:is(.dark, .dark *));   /* line 2 (신규) */
```
- 커밋 `e471a49`. 목적: 클래스토글(.dark on `<html>`) 기반 `dark:` 유틸 활성.
- **왜 `:is`인가**(검증 핵심): `:where`면 특이도 0 → `dark:bg-slate-700`이 base `bg-blue-50`과 동일특이도(0,1,0)→소스순서로 base가 이겨 다크색 미적용. `:is(.dark,.dark *)`는 +1 특이도(0,2,0)>base(0,1,0)로 항상 이김.
- 무위험 근거: 변경 전 src 전체 `dark:` Tailwind 클래스 **0개**(유일매치는 ThemeToggle 객체키, 클래스아님)→기존 CSS 출력 무변화.

### 2. `frontend/src/index.css:50,73` — color-scheme (스크롤바)
```css
:root { ... color-scheme: light; }   /* line 50 */
.dark { ... color-scheme: dark; }    /* line 73 */
```
- 커밋 `1ac658a`. 목적: 네이티브 뷰포트/내부 스크롤바·폼컨트롤이 테마 따라 렌더. applyTheme가 `<html>`에 `.dark` 토글(`lib/theme.ts`).

### 3. `frontend/src/components/meeting/AiChatPanel.tsx:110` — 질문칩 className (적응형)
```
rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100 dark:border-slate-600 dark:bg-slate-700 dark:font-bold dark:text-yellow-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
```
- 커밋 `e471a49`. 라이트=원래 파랑(비볼드), 다크=slate-700칩+볼드 yellow-300. 위 #1 custom-variant 활성에 의존.

## 검증 체크리스트 (정확성)
- [ ] `@custom-variant dark (&:is(.dark, .dark *))`가 Tailwind v4 정식 문법인가? `@import` 뒤 위치 맞나?
- [ ] `:is` vs `:where` 특이도 논리 재확인(위 주장 맞나). 더 견고한 표준형 있나?
- [ ] custom-variant 활성으로 **의도치 않게 깨어난 dark: 클래스 없나**(전체 src `dark:` 재grep — 이번 칩 외 0이어야).
- [ ] color-scheme이 `:root`/`.dark` 양쪽 선언됐나. 시스템모드(system)일 때도 일관?
- [ ] 칩 className: 라이트 base에 `font-bold` 없나(볼드는 dark만). hover/disabled 양모드 정상?
- [ ] 브라우저 실측(caddy `https://localhost:13443`, loopback=admin, 좌하단 토글): 클린 `location.reload()` 후 라이트=파랑/400, 다크=slate/yellow/700. **⚠️custom-variant 변경은 HMR이 기존 요소에 부분반영만→리로드 필수**.

## 검증 체크리스트 (체계성)
- [ ] 이 프로젝트 다크 주전략=**시맨틱 토큰**(bg-card/text-foreground/border-border). `dark:` variant 도입이 그 전략과 충돌/혼란 안 주나? 가이드라인 필요?
- [ ] 칩 색 slate-700/yellow-300은 **하드코딩**. 시맨틱 토큰으로 표현 가능했나, 아니면 모드별 강조색이라 escape hatch가 맞나?(amber 북마크 선례 `bg-amber-500/10 text-amber-600`와 일관성 비교)
- [ ] 같은 패턴(하드코딩 라이트색만 있어 다크서 깨지는 칩/뱃지)이 **다른 컴포넌트에도 있나** — 전수 스윕 권장.
- [ ] color-scheme 도입이 기존 커스텀 스크롤바/폼 스타일과 충돌 없나.

## 참고
- 관련 메모: `project_dark_mode_theme`(custom-variant :is·HMR 함정 기록됨), `project_tailwind_theme_tokens`, `reference_frontend_real_typecheck`(진짜 타입체크=`tsc -p tsconfig.app.json`).
- ultracode ON이면 Workflow로 병렬 검증(diff 정독 / Tailwind 특이도 검증 / 전체 src 하드코딩색 스윕 / 브라우저 실측) 권장.

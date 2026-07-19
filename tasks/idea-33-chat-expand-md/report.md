# idea-33 구현 보고 (implementer, sonnet)

STATUS: DONE_WITH_CONCERNS

## 변경 파일
- 신규: `frontend/src/lib/chatExport.ts`
- 신규: `frontend/src/lib/chatExport.test.ts`
- 신규: `frontend/src/components/meeting/ChatExpandDialog.tsx`
- 수정: `frontend/src/components/meeting/AiChatPanel.tsx` (통합만)

## 검증
- 신규 chatExport 테스트 9/9 통과. 전체 `npx vitest run` 1674 passed / 0 failed.
- `npx tsc -p tsconfig.app.json` → 0 errors (측정 시점 기준선 0, 신규 에러 0).
- `npx vite build` 성공 (기존 `::highlight()` CSS 경고 2건은 무관 사전존재).

## 설계 결정
1. 마커 제거 순서: `FOLDER_CITATION_RE` 먼저 → `stripCitationMarkers()` (markersToSeekLinks 순서 관례 미러링). `<br>`→`\n`은 마커 제거 후. 블랭킷 라인 trim 없음 — stripCitationMarkers의 국소 정리에만 의존 (초안의 과잉 trim은 테스트로 잡아 수정).
2. 폰트 확대: ChatMarkdown 수정 없이 `ChatExpandDialog`에서 `.chat-expand-answer` 스코프 클래스 + 인라인 `<style>`로 react-markdown이 박는 Tailwind 크기 클래스(text-sm, h1.text-base, code.text-xs, table.text-xs 등) 오버라이드. Tailwind v4 utilities는 @layer utilities라 unlayered inline style이 항상 승리 + 복합 셀렉터로 특이도도 높음. 다이얼로그 헤더 h2는 형제라 비영향.
3. 통합 관례: lucide-react `Maximize2`(AiSummaryPanel 전체보기와 동일) + `Download`(ExportButton과 동일). 항상 노출(터치 기기 고려, AiSummaryPanel 선례). 버블 하단, 아이콘 전용(p-1, w-3.5). `role==='assistant' && status==='complete'`에만. i18n 프레임워크 없음(grep 확인) → 한글 하드코딩 관례 유지.
4. 저장은 액션 행·다이얼로그 헤더 양쪽 모두 `downloadChatAnswer(m.content)` 호출, 로직 중복 없음. 저장 중 버튼 disable.

## 우려 (implementer)
- `chatAnswerToMarkdown`의 `<br>`→`\n` 정규식이 코드펜스 비인식 — 코드블록 안 `<br>` 리터럴도 export 시 개행 변환됨. 실사용 위험 낮음(챗의 `<br>` 누수는 표 셀/평문에서 발생). 필요 시 후속 티켓.
  → 수정 라운드 1에서 펜스/인라인 코드 인식 추가로 해소됨.

---

# 리뷰·수정 라운드 기록 (orchestrator)

- 1차 리뷰(sonnet): 스펙 전 항목 ✅. 품질 Needs-fixes — [Important] 저장 실패 시 무피드백(ExportButton 관례 위반), [Minor] `<br>` 코드펜스 비인식, [Minor] 조건 중복.
- 수정 R1: try/catch+메시지 스코프 에러 표시, 펜스·인라인 코드 보존 로직(`replaceBrOutsideCode`/`replaceBrOutsideInlineCode`)+테스트 3건, `isCompleteAssistant` 추출. 전체 1677/0.
- 재리뷰: 1·3 승인. 2 잔여 결함 — 이중 백틱(``) 스팬 오분류 실측(단일 백틱 홀짝 방식 한계).
- 수정 R2: 백틱 런 길이 매칭(CommonMark 규칙)으로 재작성 + 테스트 3건(g-2~g-4). 전체 1680/0.
- 최종 검증: micromark(실제 CommonMark 파서) 대조 실측 8케이스 전부 일치. **Approved**.
- 잔여 알려진 한계(비차단, 극히 드묾): 멀티라인 인라인 코드 스팬(여는/닫는 백틱이 다른 줄)은 라인 단위 스캔이라 오분류 가능 — 주석의 근사치 범주.
- 미수정 Minor(후속 판단): ChatExpandDialog 폰트 CSS의 ChatMarkdown 클래스명 커플링(스모크 테스트 없음), Dialog 중첩 시 Esc 동시 닫힘(기존 Dialog.tsx 한계), 다이얼로그 열린 동안 메시지 갱신 미반영(스냅샷), 스코프 전환 시 saveError/expandedMessage 미리셋(실충돌 가능성 낮음).

## 최종 게이트 (orchestrator 직접 실행)
- `npx vitest run src/lib/chatExport.test.ts` → 15/0
- `npx tsc -p tsconfig.app.json` → No errors found
- `npx vite build` → 성공 (기존 chunk 크기 권고만)
- 전체 스위트(수정 에이전트 실행): 1680 passed / 0 failed

## 상태: done (미커밋, 수동 검증 대기)

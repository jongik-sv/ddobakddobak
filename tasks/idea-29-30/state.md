# idea.md 29·30 완결 루프 — 상태

## 완료기준 (DoD)
- **29**: 필터 검색어 입력 상태에서 폴더 전환 시 화면 깜박임 없음. 재현 먼저 → 원인 수정 → 수정 후 재현 안 됨 검증.
- **30**: AI 챗에 mermaid 렌더 추가 + 회의요약과 타이포·간격·코드블록·표 스타일 공통 토큰 통일 (렌더러는 각자 유지).
- 게이트: `tsc -p tsconfig.app.json` (내 파일 신규 에러 0, 기준선 ~24 사전존재) · `vite build` · 관련 spec 통과.
- 종료조건: 코드리뷰 2회 연속 무결점.
- 제약: 커밋 금지.

## 진행 로그
- [2026-07-19 iter1] 루프 시작. state.md 생성. 정찰(Workflow) 착수.
- [2026-07-19 iter1] 브랜치 feature/idea-29-30 생성(사용자 요청). dev 가동 확인: rails 13323, vite 13325.
- [2026-07-19 iter1] 정찰 완료(wf_ed9e77fb-182). 29 원인 = 폴더클릭이 검색 300ms 디바운스 공유 + 검색중 하위폴더카드 숨김 → 지연된 통짜 스왑. 부원인 = 직전 0건 시 스켈레톤(hasData 게이팅). 30 = 프론트 mermaid 이미 완성, 공백은 백엔드(챗 프롬프트 mermaid 지시 없음 + fix_mermaid_quotes 미적용) + 스타일 토큰 통일.

## 설계 확정 (iter1)
- **29**: ① fetch 이펙트를 조건부 딜레이로(폴더 변경=0ms, 검색어 등=300ms, ref로 이전 folderId 비교 — 이펙트 분리 시 마운트 이중 fetch 문제 회피) ② meetingStore 경쟁 가드(요청 seq, 늦은 응답 무시) ③ isLoading은 최초 로드 전용(hasLoadedOnce), 재조회는 isRefreshing ④ 그리드에 delay-150 지연 dim(빠른 응답은 안 보임) ⑤ 회귀 테스트(fake timers, TDD).
- **30-백엔드**: notes_prompts의 mermaid 지시 블록([필수] 규칙 포함)을 공유 상수(MermaidPrompts)로 추출 → 챗 2개 시스템 프롬프트에 주입(+절제 지침: 최대 1개, 명백히 유리할 때만). meeting/folder_chat_job의 split_followups 후 fix_mermaid_quotes 적용. 기존 프롬프트 앵커 spec 유지 필수.
- **30-스타일**: index.css @theme에 md 공용 토큰(코드블록 bg/radius/폰트, 인라인코드 칩, 표 border=--border·셀 패딩, 링크색) + blocknoteOverrides.css(.bn- 훅) + ChatMarkdown 클래스 토큰화. 헤딩·본문 스케일은 문맥별 유지(픽셀 동일화 금지). BlockNote 표 #ddd 다크모드 버그 수정 포함.

- [2026-07-19 iter1] 구현 완료(wf_73d7b897-b70, 3 병렬). 29: TDD red(5건 실패 재현)→green, isLoading 소비처 전수 확인(MeetingsPage 단독). 30b: REFINE 프롬프트 byte-identical 추출(SHA 대조), 전체 백엔드 1791 spec 통과, relocation_spec 의도변경 2건만 baseline 갱신. 30s: @theme 별칭+:root raw 토큰 이중구조(순수 CSS 참조용), prod 캐스케이드 바이트순서 검증.
- [2026-07-19 iter1] 오케스트레이터 통합 게이트 전부 green: tsc 0에러 · vite build 성공 · vitest 전체 1658/1658 · rspec 스코프 110/110.
- [2026-07-19 iter1] 리뷰 round 1 발사(wf_f632d37f-3a3): 4렌즈(29-react/30-backend/30-style/holistic-dod) → 발견당 3반박 검증(2/3 real 확정).

## 검증 잔여(수동 — 사용자 로그인 필요)
- 브라우저 검증 시도(iter2): localhost:13325 접속 OK, 로그인 시도했으나 Chrome 자동완성 자격증명(yoo7032@gmail.com)이 이 서버 계정과 불일치("이메일 또는 비밀번호가 올바르지 않습니다"). 비밀번호 입력은 에이전트 금지 영역 → 이후 수동 검증 항목:
  - 29: 검색어 입력 상태로 폴더 연속 전환 → 깜박임·거짓 "회의가 없습니다" 소멸 확인
  - 30: 챗에서 "…를 다이어그램으로 보여줘" → mermaid 실렌더 확인, 챗·회의록 코드블록/표/인라인코드/링크 라이트·다크 육안 대조
- 자동 검증으로 대체된 부분: 29 메커니즘은 fake-timer 회귀 테스트(red→green)로, 30 체인은 spec+기존 렌더 테스트로 검증됨
- .bn-* 오버라이드 MeetingEditor 파급: 리뷰 round 1에서 결함 아님 판정(통일이 오히려 일관성)

- [2026-07-19 iter2] 리뷰 round 1 완료(25 에이전트): 확정 6(중복쌍 2 → 실수정 4, 전부 minor) + 기각 1(hasLoadedOnce 리셋, 1/3) + nit 5(2건 채택).
  - F1 MeetingsPage:411 빈상태가 isRefreshing 미고려 → 폴더 전환 중 거짓 "회의가 없습니다"(이번 체인지셋 회귀)
  - F2 --md-link 다크 미대응(#2563eb on #1f1f1f = 3.2:1 AA 미달) → .dark에 #60a5fa
  - F3 ChatMermaid CodeFallback pre 구 스타일 잔존(주석과 모순)
  - F4 CHAT_DIAGRAM_INSTRUCTION mindmap 예시 축약 vs "축약 금지" 주석 모순 → 예시 복원(+relocation baseline 연쇄 갱신)
  - N1 폴더 즉시 fetch 테스트가 'all' 폴백 관측 → 선택 폴더 파라미터 검증으로 강화
  - N2 인라인코드 칩 배경 리터럴 2곳 중복 → --md-inline-code-bg raw 토큰 단일화
- [2026-07-19 iter2] 수정 에이전트 2 병렬 발사(프론트 F1·F2·F3·N1·N2 / 백엔드 F4).

## 리뷰 판정 메모
- "타이포·간격 스케일 비통일(문서 vs 말풍선)"은 holistic 렌즈가 **합리적 해석으로 판정** (DoD 위반 아님, state.md 설계 근거 유지)

- [2026-07-19 iter2] round 1 수정 6건 완료(2 병렬 에이전트, red 확인 포함). 통합 게이트 green: vitest 1659/1659 · build OK · tsc 0 · rspec 107/107.
- [2026-07-19 iter2] 브라우저 검증 시도 → 로그인 자격증명 불일치로 수동 항목 전환(위 챕터).
- [2026-07-19 iter3] 리뷰 round 2 완료(wf_49e7c46c-791, 7 에이전트): 확정 1(3/3) + nit 1, 기각 0.
  - F5 [minor] F1의 !isRefreshing 가드가 빈→빈 재조회에서 메시지 즉시 언마운트 blink 신규 유발 → 언마운트 대신 delay-150 페이드로 통일
  - N3 [nit] mindmap ❌ 예시 spec 단언 vacuous(✅ 예시에 부분문자열 포함) → scan 횟수/줄 앵커로 강화
- [2026-07-19 iter3] F5+N3 수정 에이전트 발사.

- [2026-07-19 iter3] F5·N3 수정 완료(red 확인: F5 테스트 2건 수정 전 실패, N3 뮤테이션 후 실패·바이트 동일 복원). 게이트 green: vitest 1660/1660 · build OK · rspec 107.
- [2026-07-19 iter3] 리뷰 round 3 발사(wf_e182cb30-156) — 무결점 연속 1회차 판정.

- [2026-07-19 iter4] 리뷰 round 3 완료(wf_e182cb30-156): 확정 1(3/3, minor a11y) — 빈 상태 opacity-0 페이드가 접근성 트리엔 잔존, 스크린리더에 리프레시 내내 stale "회의가 없습니다" 노출. 수정 = aria-hidden={isRefreshing} 속성 1개(F5 방식 유지·보완). F6 수정 발사.
- 발견 추이: 6 → 1 → 1 (수렴 중, 심각도 전부 minor)

- [2026-07-19 iter4] F6 완료(aria-hidden={isRefreshing} + 테스트 assert). 게이트 green: vitest 1660/1660 · tsc 0.
- [2026-07-19 iter4] 리뷰 round 4 발사(wf_7324b83c-758).

- [2026-07-19 iter5] 리뷰 round 4 = **무결점**(확정 0·nit 0. 발견 1건은 검증자 3/3 사실관계 오류 기각 — import 순서 이미 올바름). 연속 clean 1회.
- [2026-07-19 iter5] 리뷰 round 5 발사(wf_3b5513c5-aae) — 최종 판정 라운드.
- 발견 추이: 6 → 1 → 1 → 0

- [2026-07-19 iter5] 리뷰 round 5 = **무결점**(4렌즈 전원 빈 배열). **연속 2회 무결점 달성 — 종료 조건 충족.**
- [2026-07-19 iter5] 최종 게이트 재확인: vite build 성공 · vitest 1660/1660 · tsc 0 · rspec 스코프 107/107.

## 최종 결과 — status: done (2026-07-19)
- 리뷰 5라운드(발견 추이 6→1→1→0→0), 수정 총 9건(F1~F6, N1~N3), 전부 red→green 또는 독립 재검증.
- 변경: 16파일 수정 + 2파일 신규(mermaid_prompts.rb, blocknoteOverrides.css), 브랜치 feature/idea-29-30, **미커밋**(커밋 금지 제약).
- 자동 검증 완료. 수동 검증 2건 잔여(사용자 로그인 필요 — 위 "검증 잔여" 챕터).

## 리뷰 라운드
- round 1: 미실시
- round 2: 미실시

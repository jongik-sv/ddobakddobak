# frontend-refactor — context (snapshot)

상태: **DONE** (슬라이스1~6b 커밋·검증, 브랜치 refactor/frontend-god 잔류·미머지). slice-7+rank8~11+store단일화=보류(별도 프로젝트). LLM설정 미커밋 유지.

## 결과 요약 (1~6b)
api/meetings 배럴분할 + 5 훅/타입 추출(useRecordingSummaryTimer흡수·useStatusMessage·useMeetingsFolderView·useLiveTermCorrections·useLiveBookmark). +44 char테스트. Tests 1260→1304 0fail(사전존재 3 suite-load실패 불변·@blocknote mock·무관). tsc delta0. LLM설정5+user.rb 미커밋 유지.

## slice-7 보류 권장 (advisor 동의)
useLiveRecording 효과추출=결합도高(getMeeting효과 6 setter, recordingDenied 7deps capture fn) + 테스트0 → param10인자(유지보수↓)/state소유(침습+검증불가) 둘다 fail. god-hook 분해는 characterization 테스트 선투자한 별도 프로젝트로. rank8~11·store단일화도 동일 패키지.

## 목표
또박 frontend 점진 리팩토링. 철칙 = **기능변경 0** (동작·출력 동일, 구조/유지보수만). 슬라이스 1개 = 1단위, 테스트 green 게이트, subagent-driven.

## 기준선 (behavior-change-0 reference)
- frontend vitest: **PASS 1260 / FAIL 0** (npx vitest run, 2026-06-21 측정)
- 리팩토링 후 1260/0 유지 필수 (characterization 추가 시 그 이상)

## 대상 god 파일 (현 줄수)
- api/meetings.ts 581 (61 exports, 미분해) ← 슬라이스1 후보(최저위험)
- pages/MeetingPage.tsx 616 (535→재팽창, citation·chat·tabs 기능 탓)
- hooks/useLiveRecording.ts 602 (일부 훅 이미 추출됨)
- pages/MeetingsPage.tsx 579 (미분해)
- pages/MeetingLivePage.tsx 549 (미분해)

## 이미 안착(main)된 이전 #7 분해
hooks/useNavigationGuards·useRecordingSummaryTimer·useBookmarks·useTermCorrections·useNotesRegeneration

## 차단 항목
- transcriptStore 단일화 = 철칙 위반(동작변경) → 사용자 명시 승인 전 금지. 근거=메모리 project_refactor_roadmap.md line 43.

## 방법(ultracode)
1. Understand 워크플로: 5 god 파일 병렬 매핑 → 분할안·리스크·순서 (run wf_453da85e-def)
2. 슬라이스별 subagent 구현 (순차, 파일충돌 회피) + 테스트 green 게이트
3. Adversarial verify 워크플로: behavior-change-0 적대 검증(diff 순수이동·signature불변·1260/0)

## 슬라이스1 ✅ DONE+검증 (미커밋)
api/meetings.ts 581→9줄 배럴 + api/meetings/{types,lifecycle,state,transcripts,audio,summary-notes,export,sharing,helpers}.ts(9파일 601LOC). 소비처 0변경. 적대검증 ALL PASS(라인diff 로직0·vitest 1260/0·tsc-delta 0·export 61동일). 상세=log.md. **미커밋**(사용자 승인 대기, main이라 branch first).

## 슬라이스2~11 = plan.md
글로벌 순서·파일충돌 시퀀싱·랜드마인·검증모드 전부 plan.md. 다음=슬라이스2(MeetingsPage types 추출, low, 앵커).

## 다음 트랙(사용자 예정)
backend·sidecar 리팩토링 (sidecar는 별도 세션 git worktree `refactor/sidecar` 권장).

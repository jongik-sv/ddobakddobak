# frontend-refactor — 슬라이스 실행 플랜 (Understand 워크플로 wf_5652aec6 합성)

철칙 = **behavior-change-0**. 게이트(매 슬라이스) = vitest 1260/0 AND tsc 에러-DELTA 0 (clean 아님; 레포 사전존재 22). 한 번에 1슬라이스, 같은 파일/계약 동시편집 금지.

## 글로벌 순서 (low→high risk)

| # | 위험 | 파일 | 도메인 | 비고 |
|---|:---:|------|--------|------|
| 1 | low | api/meetings.ts | 모듈 분할(배럴 재export) | **✅ DONE+검증**(581→9줄 배럴 + meetings/ 9파일). 소비처 0변경. |
| 2 | low | MeetingsPage.tsx | types + storage keys (ViewMode/SortField/VIEW_MODE_KEY/getStoredViewMode) | `src/pages/meetings/types.ts` 신규 서브디렉(상대경로 ../../). MeetingsPage 슬라이스의 앵커. |
| 3 | low | useLiveRecording.ts | timedSummary → 기존 useRecordingSummaryTimer로 흡수 | 반환계약 40+ 동일 유지. 소비처(MeetingLivePage) 무변경. |
| 4 | low | MeetingLivePage.tsx | status-messaging → useStatusMessage | showStatus 콜백 identity 보존(useLiveRecording로 주입). |
| 5 | low | MeetingsPage.tsx | usePageTitle + useFolderNavigation | rank-2 後. useMemo deps 정확 보존. |
| 6 | low | MeetingLivePage.tsx | bookmark/corrections/template → 훅 3개 | rank-4 後. ⚠️이름충돌: live corrections 훅은 `useLiveTermCorrections`(기존 useTermCorrections와 시그니처 다름). |
| 7 | low | useLiveRecording.ts | useRecordingNavigation + useRecordingDataSync | rank-3 後. read-mostly/GET-only. effect deps 보존. |
| 8 | med | MeetingsPage.tsx | useMeetingSort + useModalStates | rank-2,5 後. sortedMeetings useMemo deps 정확(누락=정렬 변함). |
| 9 | med | useLiveRecording.ts | sttModeResolution + audioCapture + contentReset | rank-3,7 後. useLocalStt 무조건호출(hook순서)·uploadPromiseRef 공유 유지·onStop 250ms 체인 보존. |
| 10 | med | MeetingLivePage.tsx | useLiveNotes + useSummaryOptionsControl + useEditDialog | rank-4,6 後 AND rank-9 정착 後. clearMemoEditor INPUT 변경하되 useLiveRecording 반환형 불변. |
| 11 | high | MeetingsPage.tsx | usePagination + useMeetingActions + useUrlSync | MeetingsPage 마지막. ⚠️랜드마인: url-sync useEffect(~L142/160) `eslint-disable exhaustive-deps` + 의도적 불완전 deps → **VERBATIM 이동**. meeting-actions는 currentPage/fetchMeetings 클로저 → pagination 먼저 추출 후 live param 주입(stale 클로저 방지). 내부순서: pagination→actions→url-sync. |

## 파일충돌 시퀀싱
- MeetingsPage: 2 → 5 → 8 → 11 (직렬)
- useLiveRecording: 3 → 7 → 9 (직렬)
- MeetingLivePage: 4 → 6 → 10 (직렬, 10은 rank-9 後)
- 서로 다른 파일군은 병렬 가능. 단 useLiveRecording↔MeetingLivePage 계약(40+ 반환 + clearMemoEditor 입력) 양쪽 동시편집 금지.

## 차단(behavior 변경 — 사용자 명시승인 전 금지)
- transcriptStore 단일화(MeetingPage local transcripts useState ↔ store.finals 이중소스 제거). ⚠️구분: local-state+getTranscripts effect를 useMeetingTranscripts 훅으로 **이동**(동일 state 유지)은 허용 — 이중소스 KILL만 차단.
- exhaustive-deps disable 제거/deps 재유도 = 무음 behavior 변경 → VERBATIM만.
- useLiveRecording 반환계약 변경(MeetingLivePage 미동반 시).
- `git add -A`/`commit -am`(미관련 LLM설정 5파일+user.rb 혼입) → 경로스코프 커밋만.
- 커밋/푸시 = 사용자 명시승인(main 브랜치 → branch first).

## 검증 모드
- **MODE A(모듈 분할, rank-1)**: export-name set diff=EMPTY, 내부 import 리베이스, 소비처 0편집, vitest, tsc-delta.
- **MODE B(컴포넌트내 훅/타입 추출, rank-2~11)**: public 표면 불변(default export/40+ 반환키), 이동 statement 문자단위 동일(래퍼/param/return만 추가), hook 호출순서·early-return 보존, deps배열+disable주석 VERBATIM, vitest 1260/0, tsc-delta 0, eslint delta(신규 exhaustive-deps 경고=deps 사고).

## 주의(메모리·실측 교차확인)
- MeetingPage는 이미 god 단계 대부분 통과(useMemoEditor/useMeetingSearch/useTermCorrections/useNotesRegeneration/useBookmarks 추출됨) → 상위 플랜서 제외. 남은 클러스터 저가치 + transcript-loading은 차단인접.
- tsc는 clean 아님(사전존재 22). 진짜 게이트 = DELTA 0.
- `@/*` alias 설정돼 있으나 소비처 100% 상대경로 → @/ 도입 금지(불필요 churn).
- 신규 서브디렉(pages/meetings/*) 추출 = import depth +1단계(../→../../). 훅 추출은 src/hooks/* 선호(기존 ../깊이 유지, 리베이스 불필요).

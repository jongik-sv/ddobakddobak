# Task 2 (Frontend) 리포트 — m: 마커 파싱 + inert 배지 + 왕복 보존

## 변경 파일 목록

핵심 구현:
- `frontend/src/lib/citationMarkers.ts` — `stripCitationMarkers`가 `FOLDER_CITATION_RE`(m:)도 지우도록 확장
- `frontend/src/components/meeting/citationInline.tsx` — m: 파싱(meetingId prop) + 역직렬화 복원 + splitter 일반화 + `citationMeetings`를 store에서 직접 구독(훅)
- `frontend/src/components/meeting/TimestampBadge.tsx` — `meetingId`/`meetingTitle` prop, inert span 렌더, 중립색

(`AiSummaryPanel.tsx`는 최종적으로 미변경 — 처음엔 여기에 `window.__ddobakCitationMeetings` 등록 effect를 추가했으나, 아래 "다르게 한 결정 6"의 이유로 되돌려 store 훅 직접 구독으로 바꾸면서 이 파일은 순정 상태로 복귀했다.)

배선(citation_meetings 맵을 배지까지 전달):
- `frontend/src/api/meetings/types.ts` — `Meeting.citation_meetings?: Record<string, string>` 필드 추가
- `frontend/src/stores/transcriptStore.ts` — `citationMeetings` 상태 + `setCitationMeetings` 액션(초기값 `{}`, `reset()`에도 자동 반영)
- `frontend/src/hooks/useMeeting.ts` — `getMeeting()` 응답에서 `setCitationMeetings(meetingData.citation_meetings ?? {})` (MeetingPage가 쓰는 경로)
- `frontend/src/hooks/useViewerData.ts` — 동일 패턴(MeetingViewerPage가 쓰는 경로)

테스트:
- `frontend/src/lib/citationMarkers.test.ts` — stripCitationMarkers m:/혼합 케이스 2건 추가
- `frontend/src/components/meeting/citationInline.test.ts` — m: 왕복·meetingId 보존·m:+t: 혼합 4건 추가
- `frontend/src/components/meeting/citationInline.test.tsx` — 표 셀 안 m: 마커 1건 + **실제 `BlockNoteEditor`(헤드리스) 왕복 1건** 추가
- `frontend/src/components/meeting/TimestampBadge.test.tsx` — inert span 렌더·툴팁 포맷·폴백 3건 추가

## 배경 확인 사실 (구현 전 실측)

- 백엔드는 `citation_meetings`를 **회의 상세(show) 응답의 `meeting.citation_meetings`**(SummaryResponse가 아님)에 심는다 — `backend/app/controllers/concerns/meeting_serializable.rb:106` 및 `backend/spec/requests/api/v1/meetings_citation_meetings_spec.rb:23`(`json["meeting"]["citation_meetings"]`)로 확인. 이 기준으로 `Meeting` 타입에 필드를 추가했다(브리프의 "회의 상세 응답" 가정을 SummaryResponse가 아닌 Meeting으로 확정).

## stripCitationMarkers 사용처 grep 전수 목록 (동작 변화 판단)

```
frontend/src/components/meeting/MeetingCardGrid.tsx:151   stripCitationMarkers(meeting.brief_summary)
frontend/src/components/meeting/MeetingListTable.tsx:188  stripCitationMarkers(meeting.brief_summary)
frontend/src/pages/DashboardPage.tsx:222                  stripCitationMarkers(meeting.brief_summary)
frontend/src/lib/pdfExporter.ts:321                       stripCitationMarkers(summary.notes_markdown)
frontend/src/lib/docxExporter.ts:37                        stripCitationMarkers(summary.notes_markdown)
frontend/src/lib/chatExport.ts:114-117                     FOLDER_CITATION_RE 먼저 제거 → stripCitationMarkers(t:)
```

판단:
- **pdfExporter.ts / docxExporter.ts**: `notes_markdown`을 내보낼 때 지금까지 m: 마커가 그대로 노출되던 것을 이번 확장이 고친다(원래 버그였던 것이 이번 변경의 부수 효과로 해소됨). 코드 변경 불필요 — 함수 확장만으로 해결.
- **MeetingCardGrid / MeetingListTable / DashboardPage**: `brief_summary`. 서버가 이 필드에 m: 마커를 심는지는 미확인이나(백엔드 조사 범위 밖), 확장이 상위집합이라 있으면 지워지고 없으면 무영향 — 안전.
- **chatExport.ts**: 이미 `FOLDER_CITATION_RE`로 m: 마커를 먼저 제거한 뒤 `stripCitationMarkers`(구: t:만)를 호출하던 코드. 확장 후에는 두 번째 호출이 사실상 중복(이미 m:이 없는 상태에서 다시 m: 정규식을 시도)이지만 idempotent라 동작 변화 없음. 리팩터링(중복 제거)은 이번 스코프 밖이라 손대지 않음.

## 설계와 다르게 한 결정 + 사유

1. **splitter 재설계**: 브리프의 "m: 먼저 매칭 후 t:" 지시를 문자열 `.replace()` 순차 치환이 아니라, `splitTextByMarker(content, re, buildProps)`를 정규식별로 두 번 호출하는 구조로 구현(1차 FOLDER_CITATION_RE 패스가 만든 citation 노드는 2차 CITATION_RE 패스에서 `type !== 'text'`라 자동 스킵). 기존 `inlineMarkersToCitations`가 텍스트 배열을 인덱스 추적하며 노드로 쪼개는 구조라 `.replace()` 두 번으로는 순서를 표현할 수 없었음.
2. **fast-path 가드 버그 발견·수정**: 기존 코드의 `node.text.includes('⟦t:')` 가드는 `⟦m:5/t:1234/s:화자⟧` 형태에 `⟦t:`가 문자 그대로 존재하지 않아(⟦ 뒤에 m이 옴, t:는 `/` 뒤) m:만 있는 텍스트 노드를 완전히 통과시켜 배지가 전혀 뜨지 않는 버그가 있었다. `includes('⟦')`로 완화. 왕복 테스트(`citationInline.test.ts`)를 이 가드가 실제로 커버하는 입력("⟦t:" 부분문자열이 없는 m: 전용 텍스트)으로 작성해 회귀를 막음.
3. **역직렬화 판정**: `node.props.meetingId != null` 대신 `Number(node.props.meetingId) || 0` 뒤 `> 0` 판정. propSchema 기본값(0)과 undefined(구버전 문서에서 온 citation 노드) 둘 다 "현재 회의(t:)"로 처리되게 함.
4. **중립색**: 브리프가 "회색 계열, 라이트/다크 모두 가독"이라 했는데, `speakerColor()`의 `bg-…-100 text-…-800` 하드코딩 팔레트는 다크 테마 대응이 안 됨. 이 코드베이스에서 이미 테마 대응 관용구로 쓰이는 `bg-muted text-muted-foreground`(ChatMarkdown 등)로 대체.
5. **맵 배선 범위 축소**: `setCitationMeetings` 호출은 실제 `Meeting`(citation_meetings 포함) 객체를 손에 쥔 두 지점(`useMeeting.ts`→MeetingPage, `useViewerData.ts`→MeetingViewerPage)에만 추가했고, `useNotesRegeneration`/`useTermCorrections`/`channels/transcription.ts`/`useLiveRecording.ts`/`MeetingLivePage.tsx`는 **의도적으로 미배선**으로 남겼다 — 이 경로들은 `SummaryResponse`나 웹소켓 payload처럼 `citation_meetings`를 안 실어 보낼 가능성이 높은 응답을 다루는데, 거기서 `?? {}`로 set하면 오타교정 1회에 맵이 통째로 `{}`로 덮여 모든 배지가 "이전 회의" 폴백으로 퇴화하는 회귀가 생긴다. 라이브/재생성 경로 배선은 후속 작업으로 남김(아래 우려사항 참고).
6. **맵 전달 경로: window 전역이 아니라 store 훅 직접 구독**. 처음엔 기존 `__ddobakSeek`/`__ddobakSpeakerAt`와 같은 `window` 전역 패턴으로 구현했으나, 셀프 리뷰 중 치명적 버그를 발견해 설계를 바꿨다 — `AiSummaryFullViewModal`이 `AiSummaryPanel`을 **중첩 마운트**하므로 두 인스턴스가 같은 store 값(동일 객체 레퍼런스)을 읽어 같은 전역에 쓰는데, 중첩 패널을 닫을 때 그 cleanup이 `window.__ddobakCitationMeetings === citationMeetings`(identity 일치)를 보고 **삭제**해버려 바깥 패널의 전역까지 사라지는 문제였다(바깥 패널은 deps가 안 바뀌어 재등록도 안 됨) — 전체보기를 한 번 열었다 닫으면 그 이후 모든 이전 회의 배지가 회의명을 잃는 회귀. `createReactInlineContentSpec`의 render는 실제 React 컴포넌트로 마운트되므로, `CitationInline` render 안에서 `useTranscriptStore((s) => s.citationMeetings)`를 직접 호출하도록 바꿔 전역·등록 effect·cleanup 경쟁을 전부 제거했다(`AiSummaryPanel.tsx`의 등록 effect도 삭제). 실제 BlockNoteEditor로 렌더까지 확인하진 않았지만(react-testing-library로 BlockNote를 완전히 마운트하는 기존 선례가 없음), 신규 `BlockNoteEditor` 헤드리스 테스트로 훅이 호출되는 지점까지는 데이터 흐름을 검증했다. 참고: `__ddobakSpeakerAt`도 동일한 구조적 결함이 있으나 사전 존재 코드라 스코프 밖 — 새로 만들지 않았을 뿐 고치지 않았다.
7. **inert 배지 툴팁 폴백 문구 조정**: 브리프 문구를 문자 그대로 적용하면 회의명 미상 시 `이전 회의: 이전 회의 · 화자 · 시간`으로 단어가 겹쳐 부자연스러워, 이 경우만 `이전 회의:` 접두를 생략하고 `이전 회의 · 화자 · 시간`으로 폴백하도록 조정했다.
   - **명확화(리뷰 요청 반영)**: 이 변경은 폴백 케이스에만 적용된다. `meetingTitle`이 있는 정상 케이스(회의명 조회 성공)는 브리프 문구 그대로 `이전 회의: <회의명> · <화자> · <시간>` 접두를 **유지**한다. 분기는 `TimestampBadge.tsx`의 `title = inert ? (meetingTitle ? '이전 회의: ${meetingTitle} · ...' : '이전 회의 · ...') : ...` — `meetingTitle`이 truthy일 때만 접두, falsy(빈 문자열/undefined)일 때만 접두 생략. `citationInline.tsx`는 회의명을 못 찾으면 `'이전 회의'` 같은 문자열을 만들어 넘기지 않고 `undefined` 그대로 넘겨(citationMeetings 맵에 없으면 undefined) 이 분기가 정확히 "찾음/못 찾음"으로 나뉘도록 했다. 테스트로 두 케이스 모두 확인: `TimestampBadge.test.tsx`의 "inert 배지 툴팁은 '이전 회의: <회의명> · <화자> · <시간>' 형식이다"(접두 유지)와 "meetingId>0인데 meetingTitle이 없으면 '이전 회의:' 접두 없이 폴백한다"(접두 생략) 두 테스트가 각각 검증한다.
8. **ChatMarkdown.tsx는 미변경**: m: 처리 순서(m: 먼저)의 참고 패턴으로만 인용했고, 실제로는 ChatMarkdown이 `onSeekMeeting`으로 이미 다른(클릭 가능) 방식을 쓰고 있어 이번 아이템(citationInline.tsx의 회의록 에디터)과 무관 — 손대지 않음. 회귀 테스트로 기존 `ChatMarkdown.test.tsx`가 그대로 통과함을 확인(m: 배지가 여전히 클릭 가능해야 정상).
9. **`parseCitationMarkers`는 m: 미지원 상태 유지**: grep으로 사용처를 전수 확인한 결과 자체 테스트 외 실제 호출부가 0건이라(export만 되어 있고 아무 데서도 import 안 됨) 영향 없음을 확인했다. 아이템 8이 요구한 건 `stripCitationMarkers` 확장뿐이라 `parseCitationMarkers`는 확장하지 않았다.

## 검증 명령 + 결과

```
cd frontend && npx tsc -p tsconfig.app.json     → 0 에러
cd frontend && npx vite build                    → 성공 (경고: 청크 사이즈, 기존과 동일 종류)
cd frontend && npx vitest run                     → Test Files 218 passed (218) / Tests 1970 passed (1970)
```

`npx vitest run` 전체 스위트 실행 중 `AiChatPanel.test.tsx`에서 "Maximum update depth exceeded" Uncaught Exception이 로그에 뜨지만(실행마다 12~18건으로 변동, flaky) 테스트 자체는 매번 전부 통과(1970/1970, 실패 0)한다. `git stash`로 이번 변경분을 제외하고 같은 파일만 단독 실행해도 동일 예외가 재현되어(사전 존재 이슈로 확인), 이번 변경과 무관함을 확인했다.

마커 왕복 테스트(필수 항목):
- `citationInline.test.ts`: `⟦m:5/t:90000/s:화자 1⟧`가 `markersToInline`→citation 노드(`meetingId:5,ms:90000,speaker`)→`inlineToMarkers` 왕복 후 원문과 정확히 일치함을 검증(순수 배열 변환), m:+t: 혼합 텍스트 케이스 포함.
- `citationInline.test.tsx`: 표 셀 내부 m: 케이스 + **실제 `BlockNoteEditor.create({schema: editorSchema})`(헤드리스, DOM 없이 생성 가능한 `@blocknote/core` API)로 `replaceBlocks`→`editor.document`→`inlineToMarkers`까지 왕복시켜 `meetingId`가 BlockNote의 실제 propSchema/문서 모델을 통과해 보존되는지 검증**(이게 `AiSummaryPanel.saveNow()`가 쓰는 실제 저장 경로와 동일한 순서). 순수 배열 테스트만으로는 propSchema에서 `meetingId`를 빼도 통과하는 공백이 있어 셀프 리뷰 중 추가했다.

## 우려사항

1. **라이브/재생성 경로 미배선**: `useLiveRecording.ts`, `useNotesRegeneration.ts`, `useTermCorrections.ts`, `channels/transcription.ts`, `MeetingLivePage.tsx`에서 회의록이 갱신될 때 `citationMeetings` store가 갱신되지 않는다. m: 마커는 "연결 회의 시드 각인" 시점(회의 생성 직후)에 한 번 박히는 데이터라 라이브 녹음 중간에 새로 생기진 않겠지만, 그 세션 중 페이지를 새로고침하지 않고 계속 있으면 이전 세션에서 `useMeeting`/`useViewerData`로 채워진 맵을 그대로 쓰게 된다(문제 없음). 다만 MeetingLivePage 진입 시 store가 `reset()`되며 `citationMeetings`도 `{}`로 초기화되는데 이 페이지 자체는 별도로 `citation_meetings`를 set하지 않으므로, 라이브 페이지에서는 이전 회의 배지가 항상 "이전 회의" 폴백으로만 보인다(회의명 미표시). 클릭 무동작(inert) 동작 자체는 정상 — 표시 품질만 저하. 후속 작업으로 `MeetingLivePage.tsx`의 기존 `getMeeting(meetingId)` 호출 지점에 한 줄 추가하면 해소된다.
2. **`citation_meetings` 필드 위치 확정은 실행 중 백엔드 spec 파일 grep으로만 확인**(병렬 작업이라 실시간 서버 응답으로 검증 못함) — `backend/spec/requests/api/v1/meetings_citation_meetings_spec.rb` 기준으로 `Meeting` 타입에 붙였음. 백엔드가 최종적으로 이 위치를 바꾸면 프론트 타입/훅 2곳만 수정하면 됨(범위가 좁음).
3. `chatExport.ts`의 이중 m: 제거(FOLDER_CITATION_RE 수동 제거 후 stripCitationMarkers 재호출)는 동작엔 문제없으나 중복 코드로 남아있음 — 스코프 밖이라 정리하지 않음.

## Fix round 1 (리뷰 반영)

리뷰 3건 처리 결과:

1. **툴팁 폴백 변경 출처**: 내 자신의 셀프 리뷰 중 변경(a). 팀장 우려대로 명시적 결정으로 기록했다 — 위 "다르게 한 결정 7"의 하위 항목("명확화(리뷰 요청 반영)")에 접두 유지/생략 조건을 코드 위치까지 명시해 append함.
2. **`frontend/src/__probe__.test.ts`**: 리포트 작성 전에 이미 `rm`으로 삭제 완료한 파일이었다(BlockNoteEditor propSchema 왕복이 실제로 되는지 확인용 1회성 스크래치, 확인 후 정식 테스트로 옮기고 삭제). 재확인(`find . -iname "__probe__*"`, `git status`) 결과 존재하지 않고 git에도 흔적 없음.
3. **혼합 구분자 회귀 테스트 추가**: `citationInline.test.ts`에 `⟦m:5/t:1234|s:화자⟧`(t:값과 s: 사이 파이프) → `markersToInline`으로 `{meetingId:5, ms:1234, speaker:'화자'}` 파싱 확인 → `inlineToMarkers` 역직렬화 결과가 `⟦m:5/t:1234/s:화자⟧`(`/` 정규화)로 복원됨을 기대값으로 명시하는 테스트 추가.

재검증 결과:
```
cd frontend && npx tsc -p tsconfig.app.json                                                       → 0 에러
cd frontend && npx vitest run src/components/meeting/TimestampBadge.test.tsx \
  src/components/meeting/citationInline.test.ts src/components/meeting/citationInline.test.tsx \
  src/lib/citationMarkers.test.ts                                                                   → Test Files 4 passed (4) / Tests 48 passed (48)
```

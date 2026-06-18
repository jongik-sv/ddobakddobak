# 요약 인라인 발화 근거(시각·화자) — 설계

- 날짜: 2026-06-18
- 상태: 설계 승인됨 (구현 plan 대기)
- 관련 코드: sidecar 요약, backend `llm_service`, frontend BlockNote 요약 패널

## 1. 목표

회의 요약(AI 회의록) 본문의 각 문장 끝에 "그 내용이 실제로 발화된 시각" 근거 배지를 붙인다. 배지를 누르면 오디오가 해당 시각으로 점프한다. 사용자가 요약 한 줄 한 줄을 원문 발화로 즉시 검증·추적할 수 있게 한다.

핵심 사용자 결정:
- 부착 대상: **자유서술 회의록 본문 문장까지** (구조화 항목 리스트만이 아니라 notes_markdown 본문 전체).
- 배지 형태: **타이머 아이콘(⏱) + 시각**, 아이콘 **색으로 화자 구분** (화자 번호 글자 대신 색).
- 범위: **realtime(실시간) + final 요약 둘 다** 마커를 부착한다. 단 **증분 재생성 시 이전에 작성된 마커는 보존**(수정·삭제·재배치 금지)하고, 새로 추가/갱신된 문장에만 새 마커를 단다. → realtime 화면에서도 배지가 점진적으로 나타난다.
- **AI Chat(회의에게 질문) 답변에도** 동일한 발화 근거 배지를 적용한다 (상세 §9).

## 2. 비목표 (스코프 밖)

- `meeting_minute_items` 테이블 신설 (문서상 설계만 있고 코드 미구현 — 본 기능은 기존 `notes_markdown` 기반으로 간다).
- 기존(이미 생성된) 요약 백필 — 재요약 시점에 자연히 마커가 생긴다. 일괄 재생성 안 함.
- 시각 외 메타(ended_at_ms 범위 하이라이트, transcript 패널 스크롤 동기화) — 점프는 오디오 seek만.
- `/summarize` JSON 경로(key_points/decisions 배열)의 구조화 인용 — 본 기능은 실제 회의록 경로인 `refine_notes`(요약 final) + AI Chat `answer_question` 경로에 집중.

## 3. 전체 데이터 흐름

```
Transcript (speaker_name|speaker_label, content, started_at_ms)
  └ to_sidecar_payload → {speaker, text, started_at_ms}      (이미 존재)
      └ format_transcripts → "[MM:SS|123456ms 화자1] text"   (★변경: 현재는 시각 버림)
          └ refine_notes 프롬프트 (★변경: 문장 끝 마커 출력 지침)
              └ notes_markdown (본문에 ⟦t:ms|s:화자⟧ 마커 인라인 포함)
                  └ summaries.notes_markdown 저장               (스키마 무변경)
                      └ 프론트 BlockNote 렌더 (★변경: 마커 토큰 → 타이머 배지 인라인)
                          └ 배지 클릭 → onSeek(ms) → AudioPlayer.seekTo  (기존 배선 재사용)
```

변경 지점은 ★ 3곳: (1) 트랜스크립트→LLM 입력 형식, (2) refine 프롬프트, (3) 프론트 인라인 렌더. 저장 스키마·점프 배선은 무변경/재사용.

## 4. 마커 토큰 포맷

notes_markdown 본문에 인라인으로 들어가는 텍스트 토큰.

- 포맷: `⟦t:<started_at_ms>|s:<speaker_label>⟧`
  - 예: `오늘 API 설계 방향을 정했다. ⟦t:125000|s:화자 1⟧`
- 선정 이유: `⟦ ⟧`(U+27E6/27E7)는 일반 회의 텍스트·마크다운 문법과 충돌 가능성이 거의 없어 정규식 파싱이 안전하다.
- `s:`에는 `speaker_label`("화자 1" 등 안정 식별자)을 쓴다. 표시용 화자→색 매핑의 키가 되고, `speaker_name`(사용자 지정 이름)은 프론트에서 별도 조회로 보강 가능.
- 한 문장에 복수 발화 근거 → 마커를 연달아 둔다: `... 합의했다. ⟦t:125000|s:화자 1⟧⟦t:131000|s:화자 2⟧`
- 시각 규칙: 한 문장이 여러 세그먼트에 걸치면 **가장 이른(min) started_at_ms**.

## 5. 컴포넌트별 변경

### 5.1 sidecar — 입력 형식 (`sidecar/app/llm/summarizer.py:74` `_format_transcripts`)

현재 `"{speaker}: {text}"` → `"[MM:SS|{started_at_ms}ms {speaker}] {text}"`.
- LLM이 각 발화의 정확한 ms 값을 보고 마커에 그대로 인용할 수 있도록 ms 원값을 함께 노출(사람이 읽는 MM:SS는 보조).

### 5.2 backend — 입력 형식 (`backend/app/services/llm_service.rb:419` `format_transcripts`)

sidecar와 동일 형식으로 맞춘다(두 경로가 같은 프롬프트 계약을 공유).
- 검증됨: `Transcript.to_sidecar_payload`(transcript.rb:15-19)에는 `started_at_ms`가 이미 들어있고, `format_transcripts`(llm_service.rb:419-426)가 이를 의도적으로 필터링해 `화자: 내용`만 만든다. 따라서 **payload는 무변경, `format_transcripts`만** 시각을 포함하도록 고치면 된다.

### 5.3 refine_notes 프롬프트 — **realtime + final 공통** (sidecar `prompts.py` `_REFINE_NOTES_SYSTEM_PROMPT`, backend `llm_prompts.rb`)

마커 지침은 **realtime/final 양쪽에 공통**으로 들어간다(둘 다 배지 생성). realtime/final은 `REFINE_NOTES_SYSTEM_PROMPT`(llm_prompts.rb:60-144) 본체를 공유하고 `apply_verbosity`(llm_service.rb:211-226)의 `verbosity_context(:realtime / :final)`로 길이만 분기되므로, 마커 지침은 공통 프롬프트(`MARKER_INSTRUCTION`)에 한 번만 추가하면 두 경로에 모두 적용된다 — 별도 분기 불필요.

refine_notes는 직전 `current_notes_markdown`(검증됨: job:227-228 `refine_notes(meeting.current_notes_markdown, payload, …)`, meeting.rb:193-195)을 입력받아 새 `payload`(증분 transcript)와 합쳐 재생성한다. 이 `current_notes_markdown`에는 **이전 증분이 이미 단 마커가 들어있다.**

마커 지침(`MARKER_INSTRUCTION`):
- 각 문장/항목 끝에 그 내용의 근거가 된 발화의 `⟦t:ms|s:화자⟧` 마커를 붙인다(구체 예시 포함).
- **이전 마커 보존(최우선 규칙)**: 입력 `current_notes`에 이미 있는 `⟦t:..⟧` 마커는 **그대로 보존**하고 수정·삭제·재배치하지 않는다. 새로 추가/갱신된 문장에만 새 마커를 단다.
- `s:` 화자는 **반드시 입력의 `화자 N` 형식 그대로**(speaker_N 등 변형 금지 — §5.5 색 매핑 일치 위함).
- ms·화자는 입력 트랜스크립트에 실제로 존재하는 값만 사용(환각 금지). 근거 불명확 시 마커 생략.
- 여러 발화가 근거면 가장 이른 시각 1개 기본, 필요 시 복수 마커.
- **마커는 문장 끝(마침표/개행 직후)에만**. 표 셀 내·코드블록 내·mermaid 라벨 내 삽입 금지(R6).

### 5.4 frontend — BlockNote 인라인 배지

- 신규: **타이머 배지 인라인 컴포넌트**. ⏱ 아이콘 + `formatTime(ms)`(`lib/audioUtils.ts` 재사용). 아이콘/배지 색 = 화자 → 색 인덱스. 색 팔레트는 `SpeakerLabel`의 `SPEAKER_COLORS` 재사용, 키 = `speaker_label`("화자 N"에서 N 추출 또는 등장 순서 안정 매핑).
- BlockNote **custom inline content spec**(`createReactInlineContentSpec`) + **마크다운↔블록 변환 함수**(mermaid `mermaidBlock.tsx`의 `codeBlocksToMermaid`/`mermaidToCodeBlocks` 패턴 차용):
  - 파싱(표시): `tryParseMarkdownToBlocks` 후 블록 트리의 텍스트 인라인에서 `⟦t:..|s:..⟧` 토큰을 찾아 커스텀 인라인 배지로 치환.
  - **직렬화(저장) — 누락 주의**: `AiSummaryPanel.saveNow`(102-154)가 `blocksToMarkdownLossy`(126)를 호출하기 **전에** 커스텀 인라인 배지를 다시 `⟦t:..|s:..⟧` 토큰 텍스트로 환원해야 한다. mermaid는 정변환 호출만 보이므로(`codeBlocksToMermaid`), 마커는 **양방향 함수 쌍을 모두** 만들어 로드·saveNow 양쪽에 배선 — 안 하면 사용자가 요약 편집·저장 시 배지가 소실(R1/R2).
- 클릭 핸들러: `onSeek(ms)` 호출. `AiSummaryPanel`에 `onSeek` prop 추가하고 `MeetingPage.handleSeek`를 내려준다(점프 체인은 기존 그대로).

### 5.5 화자 → 색 매핑

- **기존 export 함수 직접 재사용**(검증됨: `SpeakerLabel.tsx:32-39`가 `speakerColor(speakerLabel)` / `speakerBorderColor(speakerLabel)`를 export). 배지는 신규 매핑을 만들지 말고 **이 함수를 그대로 import** → 배지 색과 라벨 색이 항상 동일(critic 색 불일치 리스크 자동 해소).
- 인덱싱(검증됨: `speakerIndex` = `speaker_label` 끝 숫자 `/(\d+)$/` `% 10`, 없으면 0). 전제: 마커 `s:` 값이 `화자 N` 형식이어야 성립 → final/챗 프롬프트가 `화자 N` 형식 강제(§5.3, §9.2). 비표준이면 0번 색 폴백.
- **팔레트 = 10색 순환(A안 확정)**: 화자 1~10 고유색, **11명+는 색 중복 허용**(대형 회의 드묾). 색 충돌 시 배지 tooltip/aria의 `speaker_name`(사람 이름)으로 구분. 팔레트 확장·표식 병기는 하지 않음.

### 5.6 공용 인프라 (요약 ·  AI Chat 공유)

요약과 챗은 같은 토큰·배지·색 인프라를 공유한다. 렌더 래퍼만 경로별로 다르다.

- **마커 파싱 유틸**: `⟦t:ms|s:화자⟧` 토큰 파싱/직렬화를 `lib/`의 공용 함수로. 요약(BlockNote 변환)·챗(react-markdown) 양쪽이 호출.
- **타이머 배지 컴포넌트**: ⏱ + `formatTime(ms)` + 색(화자) 단일 컴포넌트. 래퍼만 경로별 — 요약은 BlockNote custom inline content spec이 배지를 감싸고, 챗은 react-markdown `components`가 배지를 감싼다.
- **화자→색 매핑**: 신규 함수를 만들지 않고 `SpeakerLabel.tsx`의 export `speakerColor`/`speakerBorderColor`를 재사용(배지·라벨 색 일치, §5.5). 10색 순환(A안).

## 6. 리스크 및 완화

| # | 리스크 | 완화 |
|---|--------|------|
| R1 | BlockNote 마크다운↔블록 라운드트립에서 커스텀 인라인 손실(`blocksToMarkdownLossy`) | mermaid가 쓴 커스텀 변환 함수 패턴을 그대로 적용. **구현 plan 1단계에서 라운드트립 spike로 검증** 후 본구현. |
| R2 | 편집 모드에서 마커 평문 노출 / undo로 본문 손실(과거 `replaceBlocks` undo 데이터손실 전력) | 인라인을 항상 커스텀 스펙으로 유지해 평문 토큰이 사용자에게 보이지 않게. 요약 재생성이 editor 내용을 replace할 때 undo 스택 영향 재점검. |
| R3 | LLM 시각 환각(존재하지 않는 ms) | 프롬프트에서 입력 존재 값만 사용·불명확 시 생략 명시. 프론트 파싱 시 토큰 ms가 실제 transcript 범위 밖이면 배지 비활성/숨김(방어적). |
| R4 | realtime 증분 재생성마다 LLM이 기존 문장을 재작성하며 마커를 누락/이동/중복 | **보존 규칙이 1차 방어**(§5.3: 이전 마커 수정·삭제 금지 최우선 지시). 그래도 best-effort라 흔들릴 수 있음 — 무해 처리: 누락 시 배지 없음, 중복 시 프론트 파싱이 동일 `(ms,화자)` 중복 마커를 dedup. realtime은 임시 표시, final 재생성에서 정착. 직렬화가 항상 정규 토큰 형식으로 환원해 다음 증분 입력의 `current_notes` 일관 유지. |
| R5 | 마커가 FTS 검색 인덱스(notes_markdown) 오염 | **반드시 처리**(critic high): `Summary` 모델 `fts_table`에 `notes_markdown` 포함되어 마커가 그대로 인덱싱됨. FTS 인덱싱 입력에서 `⟦t:..⟧` 토큰을 strip하는 전처리를 적용(검색 매칭·스니펫에 토큰 노출 방지). `summary.rb` fts 정의/인덱싱 경로 확인. |
| R6 | LLM이 표 셀·코드블록·mermaid 라벨 안에 마커 삽입 → 평문 토큰 노출 | 프롬프트에서 "마커는 문장 끝에만, 표/코드/다이어그램 내부 금지" 명시(§5.3, §9.2). 파싱 시 코드블록·표 경계 안의 토큰은 치환하지 않고 보존(또는 strip). |
| R7 | export/공유에서 마커 평문 노출(§2 비목표지만 노출은 막아야) | export(PDF/Word/공유 텍스트) 직렬화 시 마커를 strip하거나 `[MM:SS 화자]` 읽기형으로 치환. 공유받은 사용자에게도 동일 배지 렌더(읽기). |
| R8 | 읽기전용/잠금·오프라인(오디오 없음)에서 배지 클릭 동작 미정의 | 배지 클릭은 편집이 아닌 **탐색** → 잠금·읽기전용에서도 활성. 단 오디오 미준비/없음이면 비활성: 배지에 `isAudioReady`(useAudioPlayer 상태) 전달해 조건부 활성화. |

## 7. 테스트 전략

- sidecar: `_format_transcripts`가 `[MM:SS|ms 화자]` 형식 출력 단위 테스트. refine 프롬프트 골든(마커 포함 출력 파싱 가능) 테스트.
- backend: `format_transcripts` 동일 형식 단위 테스트. 회귀(기존 요약 흐름) green.
- frontend: 토큰↔배지 라운드트립 단위 테스트(파싱 후 직렬화가 원 토큰 보존 — BlockNote `saveNow` 경로 포함). 배지 클릭 시 `onSeek(ms)` 호출 테스트. 화자→색 매핑 테스트(배지·SpeakerLabel 색 일치). 표 셀·코드블록 내 토큰은 배지로 치환 안 됨 테스트(R6). 범위 밖 ms·오디오 미준비 시 배지 비활성(R3/R8).
- backend FTS: 마커 포함 notes_markdown이 FTS 인덱싱/검색 시 토큰 strip되어 검색 매칭·스니펫에 노출 안 됨(R5).
- AI Chat: 시스템 프롬프트 골든(마커 포함 답변 파싱 가능). 챗 답변 content의 마커 토큰→배지 렌더·클릭 점프 테스트. transcript 근거 없는 답변에서 마커 생략(무해) 확인.
- E2E(기기): 실시간 녹음 중 realtime 요약에 배지 점진 표시 → **증분 갱신 후 이전 마커 보존** 확인(R4). final 재요약 후에도 배지 유지·정착. 배지 클릭 시 오디오 점프. AI Chat 질문 → 답변 배지 → 점프 확인.

## 8. 미해결 / plan에서 확정할 것

- R1 spike 결과에 따라 인라인 구현 방식(커스텀 inline spec vs 읽기뷰 react-markdown 분리) 최종 결정. **plan 1단계 필수 spike**: BlockNote 마커 라운드트립(로드→편집→`saveNow`→재로드)에서 배지 보존 검증.
- 마커 토큰 정확 문자(`⟦⟧` 확정 여부) 및 복수 마커 UI 간격.
- realtime/final: **둘 다 마커 부착**(공통 프롬프트, 분기 불필요). 핵심 과제 = 증분 보존(이전 마커 불변) — 프롬프트 보존 규칙의 LLM 준수도를 plan spike에서 실측(realtime 다회 증분 후 기존 마커 유지율). 미흡하면 보강책(직렬화 정규화·dedup) 강도 조정.
- AI Chat 적용 상세는 §9.

## 9. AI Chat 답변 적용

AI Chat(회의에게 질문)은 요약과 **독립 경로**(백엔드 `LlmService.answer_question` 직접, sidecar 미경유)지만 §5.6 공용 인프라(파싱 유틸·배지·색)를 공유한다. **챗이 요약보다 구현이 쉽다**: 컨텍스트에 이미 시각·화자가 노출돼 있고, 시스템 프롬프트에 인용 지시가 이미 있으며, react-markdown 렌더에 one-shot 응답이라 BlockNote/스트리밍 난점이 없다.

데이터 흐름:
```
ChatMessage(질문) → MeetingChatJob → MeetingChatContext.build
  └ transcript_block "[MM:SS|123456ms] 화자: 내용"   (★변경: 현재 MM:SS만, ms 원값 추가)
      └ MEETING_CHAT_SYSTEM_PROMPT (★변경: 인용 지시를 ⟦t:ms|s:화자⟧ 마커로)
          └ LlmService.answer_question → 답변(content에 마커 인라인 포함)
              └ chat_messages.content 저장                (스키마 무변경)
                  └ ChatMarkdown(react-markdown) 렌더 (★변경: 마커→타이머 배지)
                      └ 배지 클릭 → onSeek(ms)            (★배선: AiChatPanel에 onSeek 전달)
```

### 9.1 백엔드 컨텍스트 (`meeting_chat_context.rb:58-69` `transcript_block`)

- 현재 `[MM:SS] 화자: 내용` — 시각이 이미 노출됨(요약 `format_transcripts`와 별개 포매터, 수정 불필요).
- ms 원값 추가 노출: `[MM:SS|123456ms] 화자: 내용`. LLM이 마커에 정확한 ms를 인용할 수 있게 한다.

### 9.2 시스템 프롬프트 (`llm_prompts.rb:254-278` `MEETING_CHAT_SYSTEM_PROMPT`)

- 라인 267의 기존 인용 지시("근거 발언 화자·시점 인용, 예 `[12:34] 김부장: …`")를 **마커 형식으로 명시 교체**(critic high: 형식 미명시면 LLM이 기존 `[MM:SS|화자]` 형식으로 답함). **답변 각 문장 끝에** 근거 발화의 `⟦t:ms|s:화자⟧` 마커 — **구체 예시를 프롬프트에 포함**(예: `결정은 보류됐습니다. ⟦t:125000|s:화자 1⟧`).
- `s:` 화자는 **반드시 `화자 N` 형식 그대로**(speaker_N 등 변형 금지 — §5.5 색 일치).
- 입력 트랜스크립트에 실제 존재하는 ms·화자만 사용(환각 금지), 근거 불명확 시 생략. 마커는 문장 끝에만, 표/코드블록 내 금지(R6).
- `<<<FOLLOWUPS>>>` 센티넬과 충돌 없게: 마커는 본문 문장 끝, 센티넬은 답변 말미(기존 `split_followups` 파싱에 영향 없음).

### 9.3 저장 (`chat_message.rb` `content`)

- 마커는 `content`에 그대로 포함. 별도 컬럼 불필요(`suggestions_json`은 그대로). 직렬화(`chat_messages_controller.rb:30-35`) 무변경.

### 9.4 프론트 렌더 (`ChatMarkdown.tsx` / `AiChatPanel.tsx`)

- ChatMarkdown(react-markdown + remark-gfm)에 마커 토큰→타이머 배지(§5.6 공용) 치환. `components` 커스텀 또는 remark/rehype 전처리. (현재 ChatMarkdown은 마커 파싱 전무 — 신규 구현.)
- one-shot 응답이라 스트리밍 토큰 절단 문제 없음.
- **onSeek 배선 — 실제 경로 더 길다**(critic high): `AiChatPanel`은 현재 `onSeek`을 받지 않고, `RightTabsPanel`(:42)이 `meetingId`만 전달한다. 배선 = `MeetingPage.handleSeek` → `RightTabsPanel` → `AiChatPanel` → `ChatMarkdown` 배지. **모바일은 별도**: `buildMeetingDetailTabs`(MeetingPage:324-345)의 chat 탭에도 `onSeek` 주입 필요(데스크톱만 하면 모바일 점프 끊김). 데스크톱·모바일 두 경로 모두 plan에서 배선.

### 9.5 챗 특유 리스크

- 답변이 transcript가 아니라 요약/일반지식 기반이면 시각 근거가 없다 → 마커 생략(무해, 배지 안 보임).
- 컨텍스트 예산(`MAX_CHARS` 120k)으로 transcript가 잘리면 마커 ms가 잘린 범위 밖일 수 있다 → 프론트 방어적 검증(범위 밖 ms는 배지 비활성/숨김, R3과 동일 처리).

# 또박또박 경쟁사 갭 재조사 — 2026-06-18

> idea.md `## 또박또박 추천 기능 — 경쟁사 대비 갭 분석`(2026-06-16 스냅샷) 재조사.
> 방법: deep-research 하네스(5각도 → 병렬 WebSearch → fetch 22소스 → 108클레임 추출 → 3표 적대검증 → 합성). **전 단계 haiku(라이트 모델)** 핀. 104 에이전트.
> 성격: **시그널 갱신**(라이트·저breadth)이지 전수조사 아님. 6/16의 16-에이전트 심층분석을 대체가 아니라 보강. 큰 테마는 재확인됐고, 일부 제품·카테고리는 이번에 미커버(아래 §6).

---

## 1. 한 줄 결론

2026 프런티어는 **"잘 잡았나"(캡처) → "어떻게 분석하나"(인텔리전스) + "라이브로 쓰나"(in-meeting)**로 이동. 또박또박이 6/16 이후 머지한 것들(폴더 교차 Q&A·인라인 인용)은 경쟁사가 **지금 따라오는** 영역 — 방향 맞음. 남은 최대 빈틈은 idea.md가 이미 지목한 **#2 라이브 in-meeting · #3 발언 점유율**, 그리고 이번에 새로 또렷해진 **번역**.

---

## 2. 6/16 이후 또박또박이 구현한 것 (DONE)

| idea.md 항목 | 상태 | 비고 |
|---|---|---|
| #1 폴더/팀 교차 AI Q&A | ✅ 머지(`b73e718`) | Granola Spaces·Avoma가 2026에 따라오는 영역 — **선점** |
| #4 요약·챗 인라인 출처 인용 + 오디오 점프 | ✅ 머지(`c7dfd01`) | 경쟁사 드묾(Granola/Fireflies만) — **우위** |
| 소프트 삭제/휴지통 | ✅ 머지(`4cd96bd`) | |
| 회의 AI 챗 | ✅ | per-user private |
| 프로젝트 관리 / export·import | ✅ | |
| 명함 OCR 참석자 / 안건 첨부 / 오타사전 | ✅ | 명함·오타사전은 경쟁사 무 — **고유** |
| 회의 잠금 + 중요 플래그 / 이전 회의 참고 | ✅ | |
| 화자분리 | ✅ | Clova Note·Daglo와 패리티 |

→ 5 Top picks 중 **#1·#4 완료**, #5(다포맷)는 `summary_verbosity` 진행 중.

---

## 3. 2026 조사로 재확인된 갭 (검증 통과 findings → 또박또박 매핑)

| 2026 경쟁사 기능 (검증✓) | 누가 | 표 | 또박또박 현 상태 | 갭 |
|---|---|---|---|---|
| **라이브 in-meeting 어시** — 회의 중 실시간 액션아이템 제안 + "누가 뭐라 했나" 질의 | MS Teams Copilot | 3-0 | LivePage+ActionCable 인프라 **보유·미사용** | **🔴 큰 갭 (idea #2)** |
| **발언 분석 스코어카드** — talk-time·질문수·모놀로그 탐지·상위25% 코칭 | Fathom | 3-0 | diarization 데이터 보유, **미가공** | **🟠 갭·저비용 (idea #3)** |
| **실시간 발화 코치** — 말속도·필러워드·감정/참여 | Read AI | 2-1 | 없음 | 🟡 갭 (선택) |
| **라이브 음성 번역** — Voice Translator(5개국어 beta, 2026-04) | Zoom AI Companion | 3-0 | 없음 | **🟠 갭 (번역)** |
| **멀티모델 AI 챗** — 10+ LLM 단일 크레딧 | Daglo(VITO) | 2-1 | per-user LLM 선택 있음, **챗 내 모델 스위칭은 부분** | 🟡 부분 갭 |
| **OS레벨 자동감지 + 화면/시각 캡처**(스크린샷·시각이해) | Shadow | 2-1 | 데스크톱 시스템오디오도 미구현 | 🟡 갭 (고비용) |
| 자동 액션 추출 + 팔로업 제안 | NAVER Clova Note | 3-0 | `action_item` 모델 존재, **제품 표면 약함** | 🟡 부분 갭 |
| **에이전트형 워크플로** — 자동 교차회의 상태보고·CRM/태스크 자동생성·다음회의 안건 제안·음성에이전트 | MS Teams Copilot Studio | 0-3·1-2† | 전무 | **🟠 실제 갭 (신규 프런티어)** |
| 화자분리 / 워크스페이스 교차 Q&A | Clova·Daglo / Granola·Avoma | — | ✅ 보유 | 패리티/선점 |

### 검증 탈락 목록 = "약한 모델이 확증 못 함"이지 "거짓"이 아님 (†)

VERIFY 프롬프트는 *"불확실하면 refuted=true"* 기본값. **haiku 검증자**에선 "불확실"이 상시 발화 → `refuted` ≈ **"단일출처라 확증 실패"**(거짓 아님). 증거: 탈락 클레임 중 명백한 핵심기능이 다수다.
- Zoom AI Companion "자동 캡처·요약·액션추출"(1-2 탈락) — Zoom의 **간판 기능**. 자명히 사실.
- Daglo "AI 요약 자동생성"·"교차문서 AI 챗"(각 1-2 탈락) — 회의노트 제품의 **핵심 기능**. 사실로 봐야 함.
- Teams **에이전트형 워크플로** 일체(0-3·1-2, 단일 windowsnews.ai) — 확증은 약하나 **2026 enterprise 리더의 방향성**. ddobak이 0인 실제 갭이므로 위 표에 행으로 승격(신호 격하 X).

→ 갭분석에서 killed 리스트는 노이즈가 아니라 **후보 갭 광맥**. 위 3건은 확증만 약할 뿐 방향은 신뢰.

---

## 4. 권장 우선순위 (현 인프라 재사용 + value/effort)

1. **발언 점유율·분석 (#3)** — value high / effort **low**. diarization 데이터 순수 후처리, 신규 캡처·LLM 비용 0. Fathom·Read AI가 2026 핵심 차별점화 → **시장이 이쪽으로 감이 재확인**. 한 스프린트 체감 최대.
2. **라이브 in-meeting 어시 (#2)** — value high / effort med. LivePage+ActionCable+per-user 챗 RAG **이미 보유** → 라이브 트랜스크립트로만 RAG 돌리면 catch-me-up/내가 놓친것/실시간 액션. **최대 미사용 자산**, 2026 enterprise table-stakes(Teams).
3. **번역 KR↔EN (신규 부상)** — Zoom이 2026-04 진입. 한국팀↔해외 실수요. 요약·전사 위 얇은 LLM 레이어부터(라이브 음성번역은 후속).
4. **멀티모델 챗 스위처** — Daglo 대비. `chat_llm_model` 위에 "이 답변은 Claude/Gemini로" 토글. 자체호스팅 = 모델 선택 자유가 오히려 강점.
5. **에이전트형 워크플로 (탐색)** — Teams가 가는 방향: 회의 종료 → 자동 액션 생성·담당자 배정·다음 안건 초안·부재자 요약 발송. ddobak은 `action_item`+미사용 Mailer+안건 첨부 인프라 보유 → 규칙기반 자동 파이프라인부터 얇게. value high / effort med-high, 후순위지만 2026 프런티어.

---

## 5. 지켜야 할 또박또박 차별점 (조사가 확인한 희소성)

- **인라인 인용 + 오디오 정확점프** — 경쟁사 드묾. 한국어 STT 불완전 → 원문대조 가치 큼. 환각 신뢰 직격.
- **폴더/프로젝트 교차 Q&A 이미 보유** — Granola Spaces·Avoma가 막 따라오는 영역.
- **자체호스팅·프라이버시·전 코퍼스 로컬** — 위 어떤 클라우드 경쟁사도 못 냄.
- **명함 OCR·오타사전** — 경쟁사 카탈로그에 없음.

---

## 6. 이 라이트 조사의 한계 + 미재조사 갭 (이전 분석 유효)

이번 haiku·5각도 조사가 **미커버**한 것 (breadth 제약, 거짓이 아니라 미조사):
- 제품: Otter·Fireflies·tl;dv·Avoma·Sembly·Notion AI·Lilys 세부 기능
- 카테고리: **아웃바운드 웹훅/스코프드 API**, **SRT/VTT 자막 내보내기**, **트랜스크립트 코멘트/@멘션/스레드**, **액션아이템 제품표면**(assignee·due·알림), **챕터/토픽 자동분할**, **시스템/루프백 오디오 캡처**

→ 위는 idea.md 6/16 분석의 판단을 그대로 유효한 것으로 본다. **→ 라운드2(§8)에서 통합·출력·협업·액션 카테고리를 직접 재조사함.** 미커버 잔여 = Otter 음성에이전트·tl;dv·Lilys 세부.

---

## 7. 출처 (검증 통과 핵심)

- MS Teams Copilot 실시간 — learn.microsoft.com/microsoftteams/copilot-teams-transcription (primary, 2025-07/2026-06 갱신)
- Fathom AI Scorecards — help.fathom.video/articles/7906049, /450176 (primary, 2025-11-25)
- NAVER Clova Note — navercorp.com 보도자료 seq=31353 (primary)
- Daglo 멀티모델 — daglo.ai/en/pricing, /blog (primary)
- Shadow vs Granola 캡처 — shadow.do/blog/...-slack-huddles-2026 (2026-05-04)
- Read AI Speaker Coach — read.ai/articles/best-ai-meeting-assistants
- Zoom Voice Translator — zoom.com/en/products/ai-assistant (beta 2026-04, 5개국어)

전체 원본 결과: 워크플로 run `wf_c5484f75-801` (22소스·108클레임·25검증·11확정).

---

## 8. 라운드2 — 미커버 제품·카테고리 직접 재조사 (동일 haiku 하네스)

> Otter·Fireflies·Avoma·Notion AI·Sembly·tl;dv 중심 + 통합/출력/협업/액션. 22소스·88클레임·**20확정**(검증 프롬프트 보정으로 false-negative 감소). run `wf_59df9b39-0e0`.

**이제 table-stakes로 굳은 것 (또박또박 미구현 = 경쟁 결손):**
- **아웃바운드 웹훅** — Otter(`conversation.completed/shared`)·Avoma·Fireflies 전부. 페이로드에 요약·액션아이템(담당자/상태/타임스탬프) 포함. (3-0)
- **스코프드 API 토큰**(Bearer/OAuth, REST/GraphQL) — Otter·Avoma·Fireflies. (3-0)
- **액션아이템 담당자·이메일·완료시각 + 태스크툴 푸시**(Asana/Notion/CRM) — Otter·Avoma·Sembly 표준. (3-0)
- **네이티브 CRM**(HubSpot 양방향=Avoma, Asana 네이티브=Otter, 나머지 Zapier) — 근표준. (3-0)

**녹음기반 table-stakes, 노트중심엔 부재:**
- **SRT/VTT 자막** — Otter(SRT 유료)·Avoma(VTT 서명URL) 보유. Notion·Sembly 미문서. 또박또박 = 데이터 완비 → 시리얼라이저만 추가. (3-0)
- 커스텀 요약 지시문 + 기성 템플릿(Sales/Standup/Team) — Notion AI Meeting Notes. (2-1)

**경쟁사 5종 모두 미문서 (= 도약 기회, 결손 아님):**
- **자동 챕터/토픽 분할(점프 타임스탬프)** — Otter/Avoma/Fireflies/Sembly/Notion 어디도 미문서. (absence of evidence)
- **트랜스크립트 코멘트/@멘션/스레드** — 동일하게 5종 미문서. altalt 대비 갭이나 *상위 경쟁사도 없음* → 또박또박이 하면 차별화 카드. (absence of evidence)

**탈락(올바른 회의)**: tl;dv "5000+ 통합·양방향 CRM"(0-3, 경쟁사 블로그 과장), Otter "양방향 Salesforce 네이티브"(0-3, 실제는 Zapier 경유), Avoma Zapier 키방식 세부(0-3).

**합산 시사**: idea.md Integration 묶음(웹훅+API)은 이제 *선택*이 아니라 *결손*. 자체호스팅 적합도 1순위 통합. SRT/VTT·액션아이템 제품표면은 저비용 catch-up. 코멘트/@멘션·챕터분할은 시장 공백 → 도약.

라운드2 출처(primary): help.otter.ai/Workspace-Webhooks·/captions-subtitles · dev.avoma.com · help.avoma.com/zapier · avoma.com/release-notes/avoma-hubspot-integration · sembly.ai/automations/notion · notion.com/help/ai-meeting-notes · docs.fireflies.ai/graphql-api/webhooks.

---

## 9. 구현 현황 인벤토리 (코드 실측, 2026-06-18)

### ✅ 구현됨 (DONE)
| 기능 | 근거 |
|---|---|
| 폴더/팀 교차 AI Q&A (#1) | merged `b73e718` |
| 회의 AI 챗 (per-meeting·per-user) | `MeetingChatJob` |
| 요약·챗 인라인 출처 인용 + 오디오 점프 (#4) | merged `c7dfd01` |
| 화자분리 (diarization + `speaker_name`) | 코드 |
| 요약 상세도 5단계 + 증분 재구성 | `summary_verbosity`/`summary_restructure` (migrate 20260611210822) |
| 회의록 전체보기 풀뷰 | `AiSummaryFullViewModal`/`FullRecord` |
| 시각 렌더 — Mermaid 블록 | `mermaidBlock.tsx` |
| 교차회의 전문 + FTS5 검색 (전역→회의내) | `49672ff` |
| 소프트삭제/휴지통/복구 | merged `4cd96bd` |
| 프로젝트별 관리 + export/import | merged `424241e` |
| 안건 첨부 → 회의록 반영 | merged `fd18c04` |
| 회의 잠금(읽기전용) + 중요 플래그 | feat/meeting-lock-importance |
| 이전 회의 참고(시드+이어쓰기) | feat/prev-meeting-reference |
| 명함 OCR 참석자 자동등록 | feat(cards) |
| 폴더별 오타사전 | feat/typo-dictionary |
| 회의 공유/비공개 | `ShareLinkButton` |
| 데스크톱 시스템/루프백 오디오 캡처 | `capture_macos.rs`(ScreenCaptureKit)·`capture_windows.rs`(WASAPI) |
| 모바일 잠금화면 백그라운드 녹음 | `RecordingForegroundService.kt`(FGS+wake/wifi lock) |
| 북마크(타임스탬프 마크) | `meeting_bookmarks` 모델 |
| Decision Log(결정 기록) | `decisions` 모델(content·decided_at·participants·status) |

### 🟡 부분 구현
| 기능 | 있는 것 | 없는 것 |
|---|---|---|
| 액션아이템 (#카테고리) | 추출 + 담당자(`assignee`) | 마감·알림·"내 미결" 뷰·태스크툴/CRM 푸시 |
| 다포맷 재구성 (#5) | 상세도 5단계·증분 재구성 | 즉석 임원보고/화자별/한줄 재성형 + 주간·1on1·킥오프 기성 템플릿 |
| 멀티모델 챗 | per-user LLM 선택 | 챗 답변별 모델 스위칭(Daglo식 10+) |

### ❌ 미구현 (갭)
**인텔리전스**: 라이브 in-meeting 어시(#2) · 발언 점유율/분석(#3) · 실시간 발화 코치 · 번역 KR↔EN · 자동 챕터/토픽 분할 · 에이전트형 워크플로(자동 상태보고·다음안건) · 사전 회의 브리프 · 폴더 정기 AI 다이제스트 · 감정/참여 신호 · 타입드 거버넌스(위험/이슈/블로커)
**통합**: 아웃바운드 웹훅 · 스코프드 API 토큰 · 네이티브 커넥터(Slack/Jira/Notion/CRM) · SRT/VTT 자막 내보내기 · 거버넌스 번들(보존정책·감사로그·2FA) · 녹음 동의/egress
**협업**: 트랜스크립트 코멘트/@멘션/스레드 · 오디오 클립·하이라이트 공유 · 사후 이메일 배포(요약+액션) · 노트 버전 이력(휴지통 복구만 있음)
**캡처**: 화면/시각 캡처(스크린샷·시각이해) — *⚠️정정: 시스템/루프백 오디오·모바일 백그라운드 녹음은 코드 실측 결과 이미 구현됨(라이트 조사 오류). §10 참조.*
**UX/콘텐츠**: 콘텐츠 인제스천(YouTube/URL·PDF 요약) · 라이브 캡션 + a11y(ARIA/스크린리더)

---

## 10. 갭별 구현 방안 (코드 실측 앵커 기반, 6-에이전트 조사 2026-06-19)

> effort: **S**=<1일, **M**=2~4일, **L**=1주+. 각 항목 = 재사용 인프라 → 추가할 것 → 앵커 파일.

### Tier 1 — 저비용 즉효 (데이터·인프라 이미 보유)

**① 발언 점유율/분석 (#3) · effort S**
- 재사용: `transcripts`(`speaker_label`·`started_at_ms`·`ended_at_ms`·`content`) 전부 존재 → 순수 후처리, DB변경 0.
- 추가: `MeetingAnalyticsService` — speaker_label 그룹화 → Σ(ended−started)=발언시간, content.split=단어수, wpm, talk/listen비, 최장 독백. `GET /meetings/:id/analytics` + FE 막대/도넛.
- 앵커: `backend/db/schema.rb:322-335`(transcripts), `frontend/.../TranscriptPanel.tsx`.
- 한계: confidence·per-word 타이밍 없음(감정/속도변동성 불가).

**② ~~SRT/VTT 자막 내보내기~~ — Tier1에서 제외 → ⑭/⑲에 묶음**
- 제외 이유: 또박또박은 오디오(mp3)만 → 자막 입힐 **영상이 없음**. 단독 수요 0. 인라인 인용+오디오점프(#4)가 "클릭→시각 점프" 가치를 회의록 안에서 이미 제공.
- 영상 캡처(⑭) 또는 라이브캡션+a11y(⑲) 도입 시 **동반**. 그때 effort S(`MeetingExportSerializer#build_transcripts:75-84`의 start/end → ms→`HH:MM:SS,mmm` 변환만).

**③ 액션아이템 제품표면 · effort S~M**
- 재사용: `action_items.assignee_id`·`due_date` 컬럼 **이미 존재**, FE `ActionItemForm.tsx`(assignee 드롭다운+date) **이미 존재**. LLM이 `assignee_hint`·`due_date_hint` **이미 추출**.
- 추가(핵심=배선): `MeetingFinalizerService#save_action_items`에서 버려지는 hint를 파싱(이름 퍼지매칭→User.id, 상대일자→date) 저장. `GET /action_items/my_open`(assignee=current_user, status≠done, 교차회의). 직렬화에 assignee·due_date 복원(`action_item_serializable.rb`). 알림=`recurring.yml`에 due-soon 크론.
- 앵커: `meeting_finalizer_service.rb`(save_action_items, hint 폐기 지점), `action_item.rb`, `config/recurring.yml`.

**④ 즉석 다포맷 재구성 + 템플릿 (#5) · effort M**
- 재사용: `PromptTemplate` 모델(`sections_prompt_for(meeting_type)`) **이미 존재**, `refine_notes`가 이미 사용. `apply_feedback` 경로.
- 추가: 템플릿 7종 `SECTIONS_PROMPT` 상수(임원보고/화자별/한줄/주간/1on1/킥오프/인터뷰) + `LlmService#reconstruct_notes(기존 summary, template)` — **전사 재-LLM 없이 기존 요약만 재성형**(저토큰). `POST /meetings/:id/summary/reconstruct?format=`.
- 앵커: `prompt_template.rb:36`, `llm_prompts.rb`(REFINE 섹션), `llm_service.rb:24`.

### Tier 2 — 중간 (LLM 레이어/모델 추가)

**⑤ 번역 KR↔EN(+다국어) · effort M**
- 재사용: `GlossaryResolver`+`MeetingGlossaryApplier#apply_all!`(요약·액션·결정·전사 일괄) → 용어 일관 번역의 앵커. 글로사리=번역 보존어 맵.
- 추가: `TRANSLATE_NOTES/TRANSCRIPT` 프롬프트 + `LlmService#translate_notes(text, target, glossary)`, `Summary.notes_markdown_translated` 컬럼, `meetings.target_language`. `POST /meetings/:id/translate`. 글로사리 갱신 시 재번역(reapply 패턴 동일).
- 앵커: `glossary_application.rb`, `meeting_glossary_applier.rb:17`, `llm_prompts.rb`.

**⑥ 멀티모델 챗 스위처 · effort M (⚠️함정)**
- 재사용: `chat_llm_model` 컬럼·`effective_chat_llm_config` 존재. provider 라우팅(`llm_service.rb:258` anthropic/openai/gemini_cli/...).
- ⚠️함정: `effective_chat_llm_config`는 **model만** 덮음(provider·auth 재사용). Claude↔Gemini는 **다른 provider** → provider별 auth 필요. + `MeetingChatJob`이 asker 아닌 **meeting.creator** 설정 사용(비대칭) → asker 기준으로 수정 필요.
- 추가: `chat_messages.llm_provider`+`llm_model` 컬럼, `User#resolve_chat_config(provider_override)`(provider별 키), 컨트롤러 `{llm_provider?, llm_model?}` 수용, Job이 answer.llm_provider로 클라이언트 구성. `GET /chat/models`.
- 앵커: `meeting_chat_job.rb:15`, `user.rb:69`, `chat_messages_controller.rb:25`.

**⑦ 자동 챕터/토픽 분할 · effort M**
- 재사용: 타임스탬프·sequence_number 존재, `__ddobakSeek` 점프 배선 존재(`AiSummaryPanel.tsx:60`).
- 추가: `ChapterService`(LLM이 전사 토픽경계 추출→`{title, start_ms}[]`) + `chapters` 모델 or summary 메타, FE 챕터 리스트 onSeek.
- 앵커: `meeting_summarization_job.rb`, `useAudioPlayer.ts:134`(seekTo).

**⑧ 사후 이메일 배포(요약+액션) · effort M**
- 재사용: ActionMailer 스캐폴드(`application_mailer.rb`), `MeetingFinalizerService`가 enqueue 앵커, solid_queue.
- 추가: `SummaryMailer#meeting_summary` + 템플릿, SMTP 주석 해제(`production.rb:61-67`, ENV), `users.email_on_meeting_completed` 선호. finalizer에서 `SummaryEmailJob.perform_later`.
- 앵커: `meeting_finalizer_service.rb:45`, `config/environments/production.rb:61-67`.

**⑨ 라이브 in-meeting 어시(catch me up) (#2) · effort M**
- 재사용: `TranscriptionChannel`+`ChatChannel`(per-user) + `SummarizationJob` 1분 크론 + `MeetingChatContext`(전사 RAG) 전부 존재.
- 추가: `MeetingAssistantInsightsJob`(요약 크론 뒤 5분마다 가벼운 LLM) — "새 액션/결정/내 이름 언급" 추출 → `meeting_{id}_chat_{user_id}`에 `type:"assistant_insights"` 브로드캐스트. FE 인사이트 패널(`RightTabsPanel` 탭 추가).
- 앵커: `summarization_job.rb`(1분 크론), `chat_channel.rb`, `meeting_chat_context.rb`.

**⑩ 트랜스크립트 코멘트/@멘션 · effort M (도약카드)**
- 재사용: ActionCable 브로드캐스트 패턴, `ProjectMembership`(멤버=@멘션 후보), transcript segment PK.
- 추가: `Comment`(meeting_id·transcript_id·user_id·text)+`Mention`(comment_id·user_id) 모델, `CommentsChannel`, FE 타임라인 코멘트 위젯+멤버 멘션 드롭다운.
- 앵커: `transcription_channel.rb`(auth/broadcast), `project_membership.rb`.

**⑪ 오디오 클립/하이라이트 공유 · effort M**
- 재사용: `meeting_bookmarks`(`timestamp_ms`) → 클립 start, `share_code` 패턴, STT 세그먼트 타이밍, 녹음 WAV.
- 추가: `AudioClip`(meeting_id·start_ms·end_ms·share_code) 모델, `/clips/:share_code` 공개 라우트, 백엔드 ffmpeg `[start:end]`→mp3(async job), FE 플레이어 span 선택.
- 앵커: `api/bookmarks.ts`, `meeting.rb:124-137`(share_code).

### Tier 3 — 큰 것 / 신규 프런티어

**⑫ 아웃바운드 웹훅 + 스코프드 API 토큰 · effort M~L (자체호스팅 최적합)**
- 재사용: `SidecarClient` Net::HTTP+에러처리 패턴, finalizer enqueue 앵커, `User.llm_api_key` 암호화 컬럼 패턴.
- 추가(웹훅): `ApiWebhook`(user·url·secret·이벤트필터) 모델, `WebhookService#deliver`(HMAC-SHA256+재시도), `WebhookDeliveryJob` finalizer에서 enqueue, `api/v1/user/webhooks` CRUD.
- 추가(API토큰): **PAT 개념 전무** → `ApiToken`(user·name·token_digest·scopes·expires) 모델, Bearer 미들웨어, `api/v1/user/api_tokens`, 스코프(`meetings:read` 등) + 작은 공개 REST.
- 앵커: `meeting_finalizer_service.rb:20`, `jwt_service.rb`, `config/routes.rb`.

**⑬ 에이전트형 워크플로 · effort M~L (신규 프런티어, Teams 대비)**
- 재사용: `MeetingFinalizerService`=동기화 펄스(LLM 결과 이미 여기 흐름), Mailer·웹훅(⑫).
- 추가: finalize 뒤 단계 — `STATUS_REPORT_PROMPT`(상태보고), `NEXT_AGENDA_PROMPT`(미결 액션·결정→다음 안건 초안), 부재자 이메일(⑧). `meetings.status_report_markdown`·`next_agenda_markdown`. 규칙기반 파이프라인부터 얇게.
- 앵커: `meeting_finalizer_service.rb`, `llm_prompts.rb`.

**⑭ 화면/시각 캡처(스크린샷) · effort M**
- 재사용: ScreenCaptureKit **이미 오디오로 사용 중**(`capture_macos.rs`) — video 출력만 비활성(width/height=2 더미).
- 추가: `SCStreamOutputType::Video` 핸들러 활성, 키프레임 추출→업로드, 백엔드 `video_file_path`, 요약에 시각 컨텍스트 OCR.
- **동반(②)**: 영상이 생기는 순간 **SRT/VTT 자막 내보내기**가 비로소 쓸모 → 같이. `SubtitleExporter`(ms→`HH:MM:SS,mmm`), effort S.
- 앵커: `frontend/src-tauri/src/audio/capture_macos.rs:49-55`, `meeting_export_serializer.rb:75-84`.

**⑮ 콘텐츠 인제스천(YouTube/URL·PDF) · effort M**
- 재사용: 사이드카 `/transcribe-file` PCM 경로, `MeetingSummarizationJob`, ffmpeg.
- 추가: 사이드카 `/ingest`(yt-dlp+ffmpeg=URL오디오, pdfplumber/OCR=PDF)→16k PCM→기존 전사·요약 흐름. `meetings.source_type/source_url`.
- 앵커: `sidecar/app/routers/stt.py`(transcribe-file).

**⑯ 거버넌스 번들(보존·감사로그·2FA) · effort L**
- 재사용: Trash soft-delete(`Trashable`), `recurring.yml` 스케줄 프레임.
- 추가: `RetentionPolicy`+`RetentionCleanupJob`(보존창 지난 trash 하드삭제, recurring.yml), `AuditLog`+`Auditable` concern(after_commit), 2FA=`rotp`/`devise-two-factor`+User otp 컬럼+`TwoFactorController`(로그인 인터셉트 `sessions_controller.rb:5`).
- 앵커: `trashable.rb`, `config/recurring.yml`, `auth/sessions_controller.rb`.

**⑰ 타입드 거버넌스(위험/이슈/블로커) · effort M**
- 재사용: `decisions` 모델·컨트롤러·LLM 추출 **이미 존재**.
- 추가: `decisions.governance_type` enum(risk/issue/blocker/open/decision)+`severity` 마이그, LLM 분류 프롬프트, FE 셀렉터+대시보드.
- 앵커: `decision.rb`, `migrate/...create_decisions.rb`.

**⑱ 실시간 발화 코치 · effort M (데이터 제약)**
- 재사용: 세그먼트 단위 속도(duration÷words) 계산 가능.
- 제약: per-word 타이밍·confidence 없음 → 필러워드 정밀탐지 불가. MVP=세그먼트 속도+패턴매칭("음/어") 수준. 정밀화는 사이드카 word-ts 필요(qwen3 무 word-ts 폐기 이력).
- 앵커: ⑱은 ①과 데이터 공유.

**⑲ 라이브 캡션 + a11y · effort M**
- 재사용: `transcriptStore.finals`+타이밍.
- 추가: `LiveCaptionsPanel`(현재 ms 세그먼트, 대형 고대비) + `aria-live="polite"` 라이브리전, 화자라벨 aria, 진행률 aria.
- **동반(②)**: 접근성·공공/교육 조달 요건과 묶어 **SRT/VTT 자막 내보내기** 제공. `SubtitleExporter`(start/end → 변환), effort S.
- 앵커: `MeetingLivePage.tsx`, `transcriptStore.ts`, `meeting_export_serializer.rb:75-84`.

### 합성 권고 (구현 순서)
**스프린트1(전부 S~M, 인프라 보유)**: ① 발언점유율 → ③ 액션아이템 배선 → ④ 다포맷. (② SRT/VTT는 제외 → ⑭/⑲ 동반)
**스프린트2**: ⑨ 라이브 어시 → ⑤ 번역 → ⑫ 웹훅+API(결손 해소).
**도약/후순위**: ⑩ 코멘트 · ⑬ 에이전트워크플로 · ⑯ 거버넌스.


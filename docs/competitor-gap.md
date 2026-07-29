# 또박또박 — 신규 개발 대상 (경쟁 갭 + 에이전틱 후보)

> **기준일 2026-07-27** (main `0b3f11c4`). 구현 여부는 코드 실측(grep). 경쟁 정보 출처는 §6.
> **이 문서에는 아직 없는 것만 적는다.** 이미 구현된 기능 목록은 `docs/기능-인벤토리.md`(2026-06-29 조사 — idea.md 39·40·43·44 및 챗 후속질문 미반영, §6 정정 참조).
> 6/18 갭 목록은 7/27 현재 **한 항목도 구현되지 않았다**(그 사이 머지분 idea.md 28~44는 전부 내부 UX·버그·권한 작업). 따라서 아래가 전부 살아 있는 개발 대상이다.

**계보 — 이 문서가 통합한 것**

| 원본 | 내용 | 현 위치 |
|---|---|---|
| `competitor-gap-2026-06-18.md` | 6/16 16에이전트 심층 + 6/18 라이트 재조사 + 6/19 코드실측 구현방안 19항목 | `docs/archive/` |
| `competitor-gap-delta-2026-07-27.md` | 7/27 경쟁 델타(MCP·브리프·번역·고지) | `docs/archive/` |
| `research/2026-06-21-feature-candidates-decision-guide.md` | 6/21 후보 결정 매트릭스 | 대체됨 배너 부착, 스냅샷 존치. **★가치평가·"비권장" 짧은 목록은 흡수 안 됨 → 가치 축이 필요하면 그 문서** |
| `features/agentic-features-candidates-2026-07-27.md` | 에이전틱 후보 + 툴 루프 설계 + 앵커 원본 (**원본 표기 B-1~B-7 = 여기 AG-1~AG-7**) | **존치** — 이 문서 §5는 요약, 설계 근거는 원본 |

---

## 1. 우선순위

**스프린트 1 — 저비용 즉효 (데이터·인프라 이미 있음)**

| | 항목 | effort | 왜 지금 |
|---|---|---|---|
| 1 | **A. 발언 점유율/분석** | S | 순수 가성비 1위. DB 변경 0, 신규 비용 0. Fathom·Read AI의 2026 핵심 차별점 |
| 2 | **B. 액션아이템 배선** | S~M | LLM이 이미 뽑은 담당자·마감을 코드가 버리는 중. 손해가 가장 명백 |
| 3 | **C. 녹음 고지·동의 UI** | S | 통신비밀보호법 리스크 대비 비용 최소. tl;dv·Granola가 제품 기능화 |
| 4 | **AG-3. 회의 자동 파일링** | S~M | 에이전틱 후보 중 최저비용. 잘못 분류된 회의가 폴더 챗·의미검색 품질을 직접 갉아먹는 중 |

**스프린트 2 — 포지션 확보**

| | 항목 | effort | 왜 지금 |
|---|---|---|---|
| 5 | **E/AG-6. MCP 서버 + ApiToken** | M~L | 2026 신규 카테고리(Granola 2월·Otter 4월). 자체호스팅 최적합. **pull 방향은 기존 문서 어디에도 없던 항목** |
| 6 | **F. 라이브 in-meeting 어시** | M | 최대 미사용 자산(ActionCable+RAG). enterprise table-stakes |
| 7 | **AG-1. 액션아이템 생애주기** | M | B(배선) 완료가 선행. 완료 판정까지 자율화 |
| 8 | **H. 번역 KR↔EN** / **G·AG-2. 사전 브리핑** | M / M | Zoom API화(5/18), Granola Briefs 출시(5/20) |

⚠️ **5를 1~4보다 위에 두고 싶다면 그건 effort 판단이 아니라 전략 판단이다.** Claude Code 상시 사용 환경이면 MCP 효용이 즉시 체감된다는 가정. 순수 가성비 기준이면 A·B·AG-3이 먼저다.

**도약 카드 (상위 경쟁사도 미문서 = 시장 공백)**: J. 코멘트/@멘션 · K. 챕터 분할 · AG-5. 에이전틱 챗(툴 루프)

**후순위**: I(클로바노트 실출시 확인 후) · AG-4 · D · L · M · N · O · P · Q · R · S · T · U · **AG-7**(선행 인프라 없어 착수 불가)

---

## 2. 개발 항목 (Tier 1 — 저비용 즉효)

### A. 발언 점유율/분석 · S
- **경쟁 근거**: Fathom AI Scorecards(talk-time·질문수·독백 탐지·상위 25% 코칭), Read AI. 또박또박은 diarization 데이터를 갖고도 미가공.
- **재사용**: `transcripts`(`speaker_label`·`started_at_ms`·`ended_at_ms`·`content`) 전부 존재 → 순수 후처리, DB 변경 0.
- **추가**: `MeetingAnalyticsService` — speaker_label 그룹화 → Σ(ended−started)=발언시간, 단어수, wpm, talk/listen비, 최장 독백. `GET /meetings/:id/analytics` + FE 막대/도넛.
- **앵커**: `backend/db/schema.rb`(transcripts), `frontend/.../TranscriptPanel.tsx`.
- **한계**: confidence·per-word 타이밍 없음 → 감정·속도변동성은 불가.

### B. 액션아이템 배선 + 내 미결 뷰 · S~M
- **경쟁 근거**: Otter·Avoma·Sembly 표준(담당자·마감·완료시각 + 태스크툴 푸시).
- **현 상태**: 컬럼(`action_items.assignee_id`·`due_date`)과 FE `ActionItemForm.tsx`(담당자 드롭다운+날짜)는 **이미 있고**, LLM도 `assignee_hint`·`due_date_hint`를 **이미 추출**(`llm_prompts/summarization_prompts.rb:13,26`). 그런데 `meeting_finalizer_service.rb:26-34`의 `save_action_items`가 `content`/`status`/`ai_generated`만 저장하고 **두 hint를 버린다**(실측).
- **추가**: hint 파싱(이름 퍼지매칭→`User.id`, 상대일자→date) 후 저장. `GET /action_items/my_open`(assignee=current_user, status≠done, 교차회의). 직렬화 복원(`action_item_serializable.rb`). due-soon 크론(`config/recurring.yml`).

### C. 녹음 고지·동의 UI · S
- **경쟁 근거**: tl;dv 봇프리 녹음 + 동의 수집 내장(GDPR/APPI), Granola `Heads Up` 조직 전체 녹음 고지(2026-04 파일럿). 2026에 독립 제품 기능으로 승격.
- **재사용**: 회의 시작 플로우(`MeetingLivePage`), 참석자 명단(`meeting_contacts`).
- **추가**: 녹음 시작 시 고지 배너 + 고지 시각·동의 여부 기록 컬럼. 공유 링크에도 고지 문구.
- **근거**: 국내 통신비밀보호법(대화 당사자 아닌 자의 녹음 금지).

### D. 즉석 다포맷 재구성 + 템플릿 · M
- **경쟁 근거**: Notion AI Meeting Notes(커스텀 지시문 + Sales/Standup/Team 기성 템플릿).
- **현 상태**: 상세도 5단계·증분 재구성은 있음. **없는 것** = 즉석 임원보고/화자별/한줄 재성형, 주간·1on1·킥오프 템플릿.
- **재사용**: `PromptTemplate#sections_prompt_for(meeting_type)`, `refine_notes` 경로.
- **추가**: 템플릿 7종 상수 + `LlmService#reconstruct_notes(기존 summary, template)` — **전사 재-LLM 없이 기존 요약만 재성형**(저토큰). `POST /meetings/:id/summary/reconstruct?format=`.
- **앵커**: `prompt_template.rb:36`, `llm_prompts.rb`, `llm_service.rb:24`.

---

## 3. 개발 항목 (Tier 2 — 중간)

### E (=AG-6). MCP 서버 + `ApiToken` · M~L 🔴
- **경쟁 근거**: Granola MCP 서버(2026-02) + personal/enterprise API, Otter AI Chat Connectors(2026-04-28, MCP **클라이언트**로 Gmail·Drive·Notion·Jira·Salesforce를 챗에 끌어오고 MCP **서버**로 ChatGPT·Claude에 회의 히스토리 개방), Fireflies·Fellow·MeetGeek·Krisp. **2026에 새로 굳은 카테고리, 또박또박 0.**
- **재사용**: 하이브리드 검색(`transcript_vector_search`·FTS5 RRF), 스코프 컨텍스트(`folder_chat_context.rb`·`meeting_chat_context.rb`), 인가 필터(`accessible_by`).
- **⚠️ 선행조건 — 인증이 없다**: `ApiToken` 부재 실측 확인. `jwt_service.rb`의 JWT는 세션 스코프·만료형이라 장수명 MCP 연결에 부적합 → `ApiToken`(user·name·`token_digest`·scopes·expires) + Bearer 미들웨어 + 스코프(`meetings:read` 등)가 **먼저**. 그래서 effort가 M이 아니라 M~L.
- **추가**: MCP 서버(읽기 전용부터) — 툴 `search_meetings`·`get_meeting_summary`·`list_action_items`·`ask_folder`. 어댑터 자체는 기존 서비스의 얇은 래퍼.
- **AG-5와 공유**: 툴 정의를 `ToolRegistry` 하나로 두면 에이전틱 챗·MCP **두 표면**에 재사용. 인가도 동일 `accessible_by`를 도구 레이어에서 강제.
- **보안**: 자체호스팅이라 토큰 유출 = 전 회의 노출. scope 필수, 기본 만료 필수, **read-only부터**. write 도구는 별도 결정 전까지 금지.
- **후속**: MCP 클라이언트(외부 소스를 챗 컨텍스트로 — Otter AI Chat Connectors 대응), 아웃바운드 웹훅(`ApiWebhook` + HMAC-SHA256 + `WebhookDeliveryJob`, finalizer에서 enqueue) — Otter·Avoma·Fireflies 전부 보유한 결손 항목. 웹훅은 push, MCP는 pull로 방향이 다르다.
- **포지션**: 자체호스팅 = "데이터는 내 서버에 둔 채 Claude/ChatGPT가 질의". 클라우드 경쟁사가 구조적으로 못 냄.
- **앵커**: `config/routes.rb`(webhook·api_token 라우트 없음), `jwt_service.rb`, `meeting_finalizer_service.rb`.

### F. 라이브 in-meeting 어시 · M 🔴
- **경쟁 근거**: MS Teams Copilot(회의 중 액션 제안·"누가 뭐라 했나"), Otter Meeting Agents(음성 호출로 회의에 직접 참여), Zoom `@Zoomie`(2026-06, 멘션·음성 명령으로 액션·룸 설정).
- **재사용**: `TranscriptionChannel`+`ChatChannel`(per-user) + `SummarizationJob` 1분 크론 + `MeetingChatContext`(전사 RAG) — **전부 존재. 최대 미사용 자산.**
- **추가**: `MeetingAssistantInsightsJob`(요약 크론 뒤 5분마다 가벼운 LLM) — "새 액션/결정/내 이름 언급" 추출 → `meeting_{id}_chat_{user_id}`에 `type:"assistant_insights"` 브로드캐스트. FE 인사이트 탭(`RightTabsPanel`).
- **앵커**: `summarization_job.rb`, `chat_channel.rb`, `meeting_chat_context.rb`.

### G (=AG-2). 사전 회의 브리핑 · M
- **경쟁 근거**: Granola `Briefs`(2026-05-20, Mac/Win) — 회의 참여 순간 직전 맥락 브리핑. idea.md 13·14·15가 소망으로만 적혀 있던 것을 에이전트로 설계.
- **재사용**: `ScheduleRolloverJob`이 이미 도는 **1분 스케줄 크론**(`config/recurring.yml`), `meetings.scheduled_start_time`·`recurrence_rule`, `agenda_reference_job.rb`, `tauri-plugin-notification`(`frontend/src-tauri/Cargo.toml:32`).
- **추가**: `MeetingPrepJob`(T-30/T-10 윈도우 스캔, 멱등 가드는 rollover 패턴 복사) → 이전 회의 미결 액션 + 최근 결정 + 첨부 안건 → `meetings.prep_brief_markdown`·`prep_notified_at` + 알림 + 회의 진입 시 상단 카드.
- **⚠️ 주의**: 알림은 클라이언트가 살아 있어야 뜬다 — 데스크톱 백그라운드 실행(idea 12 완료)에 의존. 서버만 도는 상태에선 브리프가 생성돼도 전달되지 않는다.

### H. 번역 KR↔EN(+다국어) · M
- **경쟁 근거**: Zoom Translator API + Summarizer API(2026-05-18, 9개어, 서드파티 호출 가능), Voice Translator "내 목소리를 번역해 재생"(백엔드 2026-07-27 예정), 다글로 16개어 받아쓰기.
- **재사용**: `GlossaryResolver`+`MeetingGlossaryApplier#apply_all!`(요약·액션·결정·전사 일괄) → **글로사리 = 번역 보존어 맵**.
- **추가**: `TRANSLATE_NOTES/TRANSCRIPT` 프롬프트 + `LlmService#translate_notes(text, target, glossary)`, `Summary.notes_markdown_translated`, `meetings.target_language`, `POST /meetings/:id/translate`. 글로사리 갱신 시 재번역(reapply 패턴 동일).
- **앵커**: `glossary_application.rb`, `meeting_glossary_applier.rb:17`, `llm_prompts.rb`.

### I. 화자 자동 식별(참석자 매칭) · M
- **경쟁 근거**: 클로바노트 — ⚠️ 네이버웍스 **사전 안내 공지(2026-03-04 게시, 2026-04 적용 예정)**, **실출시 미확인**. 화자 분리를 넘어 신원 자동 식별(관리자 on/off).
- **현 상태**: 화자 이름은 **완전 수동** — `speakers_controller#update`가 사이드카 `rename_speaker` 호출 + `transcripts.speaker_name` 갱신뿐. 참석자·명함 데이터와의 자동 매칭 코드 0.
- **재사용**: 명함 OCR 참석자(`meeting_contacts`·`card_extraction_service.rb`), 이전 회의 화자 이름 이력, 도메인 용어.
- **추가**: 전사 문맥의 자기소개·호명("김 팀장님") 패턴을 LLM으로 추출 → 참석자 명단 매칭 → `speaker_label→name` 제안(확정은 사용자 1클릭). 음성 지문 없이 1차 가능.
- **앵커**: `speakers_controller.rb`, `re_diarize_job.rb`, `meeting_contact.rb`.

### J. 트랜스크립트 코멘트/@멘션 · M ⚪ 도약 카드
- **경쟁 근거**: Otter·Fireflies·Avoma·Sembly·Notion **5종 모두 미문서** = 시장 공백.
- **재사용**: **#44의 `MeetingCollaborator`/`FolderCollaborator`가 @멘션 후보 풀로 그대로 사용 가능**(6월 대비 배관 비용 하락), ActionCable 브로드캐스트 패턴, transcript segment PK.
- **추가**: `Comment`(meeting_id·transcript_id·user_id·text)+`Mention` 모델, `CommentsChannel`, FE 타임라인 코멘트 위젯.
- **앵커**: `transcription_channel.rb`, `meeting_collaborator.rb`.

### K. 자동 챕터/토픽 분할 · M ⚪ 도약 카드
- **경쟁 근거**: 경쟁 5종 모두 미문서.
- **재사용**: 타임스탬프·`sequence_number`, `__ddobakSeek` 점프 배선(`AiSummaryPanel.tsx:60`).
- **추가**: `ChapterService`(LLM이 토픽 경계 추출 → `{title, start_ms}[]`) + FE 챕터 리스트 onSeek.
- **앵커**: `meeting_summarization_job.rb`, `useAudioPlayer.ts:134`.

### L. 사후 이메일 배포(요약+액션) · M
- **경쟁 근거**: Otter·Avoma 표준(부재자 요약 발송).
- **재사용**: ActionMailer 스캐폴드(`application_mailer.rb`가 유일 — 실제 메일러 없음), `MeetingFinalizerService` enqueue 앵커, solid_queue.
- **추가**: `SummaryMailer#meeting_summary` + 템플릿, SMTP 주석 해제(`production.rb:61-67`), `users.email_on_meeting_completed` 선호.

### M. 오디오 클립/하이라이트 공유 · M
- **재사용**: `meeting_bookmarks.timestamp_ms` → 클립 start, `share_code` 패턴, 녹음 원본.
- **추가**: `AudioClip`(start_ms·end_ms·share_code) + `/clips/:share_code` 공개 라우트 + ffmpeg 구간 추출 job + FE 구간 선택.

### N. 멀티모델 챗 스위처 · M ⚠️함정
- **경쟁 근거**: Daglo 10+ LLM 단일 크레딧. 또박또박은 per-user 선택만 있고 답변별 스위칭 없음.
- **⚠️ 함정 2개**: `effective_chat_llm_config`는 **model만** 덮는다(provider·auth 재사용) → Claude↔Gemini는 provider가 달라 provider별 auth 필요. 그리고 `MeetingChatJob`이 asker가 아닌 **meeting.creator** 설정을 쓴다(비대칭) → asker 기준 수정 필요.
- **추가**: `chat_messages.llm_provider`+`llm_model`, `User#resolve_chat_config(provider_override)`, `GET /chat/models`.
- **앵커**: `meeting_chat_job.rb:15`, `user.rb:69`, `chat_messages_controller.rb:25`.

---

## 4. 개발 항목 (Tier 3 — 큰 것 / 프런티어)

### O. 에이전트형 워크플로 · M~L
- **경쟁 근거**: Teams Copilot Studio(자동 교차회의 상태보고·CRM/태스크 생성·다음 안건 제안), Zoom AI 3.0 agentic workflows.
- **재사용**: `MeetingFinalizerService`=동기화 펄스, Mailer(L)·웹훅(E).
- **추가**: finalize 뒤 `STATUS_REPORT_PROMPT`·`NEXT_AGENDA_PROMPT`(미결 액션·결정 → 다음 안건 초안), 부재자 이메일. `meetings.status_report_markdown`·`next_agenda_markdown`. 규칙기반 파이프라인부터 얇게.

### P. 화면/시각 캡처 (+SRT/VTT 자막 동반) · M
- **경쟁 근거**: Shadow(스크린샷·시각 이해), Otter 멀티모달(화면 공유 인식·스크린샷 자동 반영).
- **재사용**: ScreenCaptureKit **이미 오디오로 사용 중** — video 출력만 비활성(width/height=2 더미).
- **추가**: `SCStreamOutputType::Video` 핸들러 활성 → 키프레임 추출·업로드 → 요약에 시각 컨텍스트.
- **동반**: 영상이 생기는 순간 자막이 비로소 쓸모 → `SubtitleExporter`(ms→`HH:MM:SS,mmm`), effort S. **영상 없이 자막만 내보내는 건 수요 0 → 단독 착수 금지.**
- **앵커**: `frontend/src-tauri/src/audio/capture_macos.rs:49-55`, `meeting_export_serializer.rb:75-84`.

### Q. 콘텐츠 인제스천(YouTube/URL·PDF) · M
- **재사용**: 사이드카 `/transcribe-file` PCM 경로, `MeetingSummarizationJob`, ffmpeg.
- **추가**: 사이드카 `/ingest`(yt-dlp+ffmpeg = URL 오디오, pdfplumber/OCR = PDF) → 16k PCM → 기존 전사·요약 흐름. `meetings.source_type/source_url`.
- **앵커**: `sidecar/app/routers/stt.py`.

### R. 거버넌스 번들(보존정책·감사로그·2FA) · L
- **재사용**: `Trashable` soft-delete, `recurring.yml` 스케줄 프레임.
- **추가**: `RetentionPolicy`+`RetentionCleanupJob`(보존창 지난 trash 하드삭제), `AuditLog`+`Auditable` concern(after_commit), 2FA(`rotp`/`devise-two-factor` + User otp 컬럼 + `TwoFactorController`, 로그인 인터셉트 `sessions_controller.rb:5`).

### S. 타입드 거버넌스(위험/이슈/블로커) · M
- **재사용**: `decisions` 모델·컨트롤러·LLM 추출 존재.
- **추가**: `decisions.governance_type` enum(risk/issue/blocker/open/decision)+`severity` 마이그, 분류 프롬프트, FE 셀렉터+대시보드.

### T. 실시간 발화 코치 · M (데이터 제약)
- **경쟁 근거**: Read AI Speaker Coach(말속도·필러워드·감정/참여).
- **제약**: per-word 타이밍·confidence 없음 → 필러워드 정밀 탐지 불가. MVP = 세그먼트 속도 + 패턴매칭("음/어"). 정밀화는 사이드카 word-ts 필요(qwen3 무 word-ts 폐기 이력).
- A와 데이터 공유.

### U. 라이브 캡션 + a11y · M
- **재사용**: `transcriptStore.finals`+타이밍.
- **추가**: `LiveCaptionsPanel`(현재 ms 세그먼트, 대형 고대비) + `aria-live="polite"` 라이브리전, 화자라벨 aria, 진행률 aria.
- **동반**: 공공·교육 조달 요건과 묶어 SRT/VTT 내보내기(S).
- **앵커**: `MeetingLivePage.tsx`, `transcriptStore.ts`, `meeting_export_serializer.rb:75-84`.

---

## 5. 에이전틱 후보 (AG 계열)

> 원본·설계 근거·앵커: `docs/features/agentic-features-candidates-2026-07-27.md`. 여기엔 요약만.
> 선별 필터 4조건: ①사용자 프롬프트 없이 트리거 ②다단계(관찰→판단→행동 2회 이상) ③상태·도구를 읽고 씀 ④시스템이 판단, 사람은 승인.
> AG-2는 위 **G**, AG-6은 위 **E**로 흡수(중복 제거).

### 공통 인에이블러 — 툴 루프 (AG-1·AG-4·AG-5·AG-6 공유)
- **현황**: `LlmService`에 도구 호출 개념이 전혀 없다. 모든 공개 경로가 `call_llm_raw`(`llm_service.rb:347`)로 모여 **텍스트 1회 왕복**으로 끝난다.
- **⚠️ native function calling은 선택지가 아니다**: 프로바이더 분기에 `claude_cli`·`gemini_cli`·`codex_cli`가 있고 이들은 텍스트 in/out 전용. anthropic/openai 전용 방식을 고르면 **프로바이더 자유도(제품 차별점)를 깬다**.
- **대안**: JSON 플래너 루프(프로바이더 무관) — 계획(JSON) → 실행기가 도구 호출 → 관찰 주입 → 반복. 재료는 검증됨: `call_llm_json`(`llm_service.rb:638`) + `TextFormatter.extract_json`(`text_formatter.rb:30`)이 summarize·summarize_action_items·extract_domain_terms 3곳에서 **전 프로바이더 실사용 중**.
- **⚠️ 함정**: `extract_json`은 코드펜스만 벗긴다. 앞뒤 산문이 섞이면 `JSON::ParserError` → nil(`llm_service.rb:641-642`). 루프에선 스텝 낭비 → **재프롬프트 1회 + 단발 RAG 폴백**을 처음부터 설계에 넣을 것.
- **예산 가드 필수**: 로컬 CLI 프로바이더는 스텝당 수 초~수십 초. 최대 스텝·누적 토큰 상한 없이 배포 금지.

### AG-1. 액션아이템 생애주기 · M
- **B와 다른 것**: B는 버려지는 hint를 잇는 *배관*. 이건 항목 생성 **이후**를 자율로 굴린다.
- **동작**: finalize 후 → 같은 폴더/이전 회의 체인의 미결 항목을 현재 전사와 대조 → "완료/차단/기한 밀림" 판정 → **상태 변경 제안** + 근거 전사 구간(transcript_id + ms). 사용자 1클릭 승인.
- **재사용**: `transcript_vector_search.rb`+FTS, `meetings.previous_meeting_id` 체인, 인용 마커(`⟦t:…⟧`→`__ddobakSeek`) → 근거 클릭 점프가 공짜.
- **⚠️ 체이닝 지점**: finalize 진입점이 **4갈래**다. `meeting.rb:350`·`meetings_controller.rb:405,555`는 `MeetingFinalizerJob.perform_later`지만 `file_transcription_job.rb:56`은 **서비스 직접 동기 호출** → job에만 후속을 붙이면 업로드 경로가 통째로 누락. `MeetingFinalizerService` 말미 체이닝이 안전.
- **선행**: B(hint 배선).

### AG-3. 회의 자동 파일링 · S~M
- **동작**: 회의 종료 직후 ①폴더 ②`meeting_type` ③태그 ④일회성 회의의 `previous_meeting_id` 연결을 제안. ①②③은 현재 전부 수동.
- **④ 범위 정정(실측)**: 반복 시리즈는 **이미 자동 체이닝**된다(`materialize_next_occurrence!`가 successor에 `previous_meeting_id` 삽입, `meeting.rb:102`). 미연결로 남는 건 일회성 회의뿐 — 그때만 seeded_merge(이어쓰기, `meeting_summarization_job.rb:175,329`)가 안 켜진다.
- **재사용**: `transcript_embeddings` 유사도, `tags`/`taggings`, `PromptTemplate#sections_prompt_for(meeting_type)` — 분류가 맞으면 요약 품질까지 따라 오른다.
- **추가**: `MeetingFilingJob`(임베딩 centroid + LLM 확인), 제안 배너 UI.

### AG-4. 요약 자기검증(critic) · M
- **동작**: 요약 직후 critic 패스가 각 항목을 전사와 대조 → 근거 없는 문장(할루시네이션)·누락된 결정 검출 → 플래그 또는 1회 재생성.
- **왜 이 제품에서 특히**: LLM 선택이 사용자별로 열려 있고(ollama·lmstudio·CLI 포함) 로컬 소형 모델도 굴러간다 → 품질 편차가 기본값인데 검증 레이어가 0.
- **재사용**: 요약이 이미 발화 근거 마커(ms)를 달고 나온다 → **LLM 없이 기계적으로** 1차 검증 가능(ms가 실제 전사 구간과 맞는지). 2차 의미 대조만 LLM.
- **추가**: `SummaryCriticJob`, `summaries.critic_report_json`, 저신뢰 문장 하이라이트.
- **판단 필요**: 자동 재생성은 요약 비용 2배 → 플래그만 두고 사용자가 누르게 하는 편이 싸다.

### AG-5. 에이전틱 챗(툴 루프) · L ⚪ 도약 카드
- **현 한계**: 챗은 **컨텍스트 선조립 후 단발 응답**(`meeting_chat_context.rb`·`folder_chat_context.rb`가 발췌를 미리 넣고 `answer_question` 1회). "A가 지난 분기에 약속한 것 중 아직 안 끝난 게 뭐야?" 같은 다중 홉은 구조적으로 못 푼다.
- **추가**: `ToolRegistry`(read-only 6종부터 — `search_transcripts`·`get_summary`·`list_action_items`·`list_decisions`·`speaker_stats`·`compare_meetings`) + `AgentLoop`(최대 스텝·토큰 예산, trace 저장).
- **재사용**: 도구 구현체 전부 존재(`search_service.rb`·`transcript_vector_search.rb`·`folder_chat_query_expansion.rb`).
- **판단 필요**: 기존 단발 챗을 대체 vs "깊게 찾기" 모드로 병치 → **병치가 안전**(루프는 느리고 비싸다).
- **연계**: `ToolRegistry`는 E(MCP)와 공유 → 1회 투자로 두 표면.

### AG-7. 글로사리/오타사전 자가학습 · M — **지금은 착수 불가**
- **동작**: 같은 수정을 반복하면 감지 → 폴더 글로사리 항목 제안 → 승인 시 `apply_all!` 재적용.
- **재사용**: `GlossaryResolver`의 회의>폴더>조상 상속 + `MeetingGlossaryApplier#apply_all!` 재적용 패턴이 이미 완성형.
- **⚠️ 선행조건 부재**: 편집 전/후 diff를 남기는 곳이 없다. **수정 이력 캡처가 실제 비용의 대부분.**

### 에이전트 공통 설계 원칙
- 에이전트의 쓰기는 전부 **제안 → 사람 승인**. 회의 기록을 조용히 바꾸지 않는다.
- 모든 판단에 **근거(transcript_id + ms)** 를 붙인다. 인용 점프 배선이 이미 있어 검증 비용 ≈ 0.
- 인가는 도구 레이어에서 **`accessible_by`로 일원화** — 에이전트가 늘수록 인가 우회 표면이 는다. idea 44 감사에서 IDOR 3건이 나온 전례.

---

## 6. 후속 확인 과제 · 조사 한계

**문서 정정 대기 2건** (실측으로 확인됨, 반영은 미결정)
1. `docs/기능-인벤토리.md`의 "챗 후속 예상 질문 = 계획" → **구현 완료**(클릭 연결까지). 백엔드 `split_followups`(`folder_chat_job.rb:24`·`meeting_chat_job.rb:24`)·`chat_messages.suggestions_json`, 프론트 칩 클릭→send(`AiChatPanel.tsx:203-218`). **idea.md 49도 완료 표기 대상.**
2. `idea.md` 11번 "자동으로 이어지는 회의 = 미완료" → **부분 구현**. `recurrence_rule`·`scheduled_start_time`·`Recurrence.next_occurrence`·`ScheduleRolloverJob`(1분 크론)이 다음 occurrence를 멱등 생성 중. 남은 건 "몇 분 뒤 시작할 연결 회의 자동 생성"뿐.

**확인 과제**
- [ ] 클로바노트 화자 자동 식별 **실출시 여부**(공지는 2026-03-04 사전 안내 / 4월 적용 예정) → I 긴급도 재판정.
- [ ] Fireflies·Fathom·Avoma·Sembly **공식 체인지로그 직접 확인** — 7/27 조사에서 404·검색노이즈로 실패, 2차 출처 대체됨.
- [ ] tl;dv·Lilys 세부 — 6/18·7/27 두 조사 모두 부분 커버.

**조사 이력**

| 조사 | 방법 | 규모 |
|---|---|---|
| 2026-06-16 | 16에이전트 심층분석 | 원본 갭 목록 |
| 2026-06-18 R1 | deep-research 하네스, **전 단계 haiku** | 104에이전트 · 22소스 · 108클레임 · 11확정 |
| 2026-06-18 R2 | 동일 하네스, 미커버 제품·카테고리 | 에이전트 수 미기재 · 22소스 · 88클레임 · 20확정 |
| 2026-06-19 | 6에이전트 코드 실측 | 구현방안 앵커 |
| 2026-06-21 | HEAD 재실측 | 후보 결정 매트릭스(대체됨) |
| **2026-07-27** (경쟁) | 직접 WebSearch/WebFetch | **8콜** · 직접 fetch 3건 (좁은 델타) |
| **2026-07-27** (에이전틱) | HEAD 코드 실측 | AG-1~AG-7 후보 + 툴 루프 설계 |

**주의**
- 6/18 검증 프롬프트는 *"불확실하면 refuted=true"* + haiku 검증자 → `refuted` ≈ "단일출처라 확증 실패"이지 "거짓"이 아니다.
- 7/27 조사는 좁다. "미발견 = 없음"이 아니다.
- 6/18 문서 오류 1건 정정 이력: 시스템/루프백 오디오·모바일 백그라운드 녹음을 미구현으로 적었으나 실제로는 **이미 구현**이었다(라이트 조사 오류). 그래서 이 문서의 구현 여부는 전부 grep 실측 기반이다.

**출처 — 직접 fetch(primary)**
- Otter AI Chat Connectors(MCP)·Meeting Agents·Desktop — otter.ai/blog (2026-04-28)
- Granola Updates(Briefs 2026-05-20 / Android 2026-07-01) — granola.ai/docs/changelog
- 클로바노트 화자 자동 식별 — naver.worksmobile.com/notice/96944 (2026-03-04 게시 / 2026-04 적용 예정)

**출처 — 2차(검색 요약 기반)**
- Granola MCP 서버(2026-02)·personal/enterprise API·Heads Up — bluedothq.com/blog/granola-review, techcrunch.com/2026/03/25
- Zoom Translator/Summarizer API(2026-05-18)·Voice Translator·@Zoomie·AI 3.0 — news.zoom.com, bluente.com, releasebot.io
- MCP 카테고리 정착(Fellow·Fireflies·MeetGeek·Krisp) — meetingnotes.com/blog/ai-meeting-notes-with-mcp-and-ai-agent-integration
- tl;dv 봇프리+동의 수집 — tldv.io/blog · 다글로 16개어 — daglo.ai/blog

**출처 — 6/18 primary(원문 archive 참조)**: learn.microsoft.com/microsoftteams/copilot-teams-transcription · help.fathom.video · navercorp.com(seq=31353) · daglo.ai/pricing · read.ai · zoom.com/ai-assistant · help.otter.ai/Workspace-Webhooks · dev.avoma.com · docs.fireflies.ai/graphql-api/webhooks · notion.com/help/ai-meeting-notes

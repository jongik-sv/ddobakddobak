# 경쟁사 갭 델타 — 2026-07-27

> `competitor-gap-2026-06-18.md`(104에이전트 심층조사)의 **델타 갱신**. 대체 아님.
> 이번 조사 범위 = **좁음**: 직접 WebSearch/WebFetch 8콜, 제품 공식 블로그·체인지로그 중심(Otter·Granola·Zoom·Clova·tl;dv). 워크플로/서브에이전트 미사용.
> 구현현황은 **코드 실측**(grep, 2026-07-27).

---

## 1. 한 줄 결론

6/18 갭 목록은 **한 항목도 구현되지 않았다**(실측). 그 사이 머지된 idea.md 28~44는 전부 내부 UX·버그·권한 작업. 그리고 2026 상반기에 경쟁사 쪽에 **새 카테고리 하나가 굳었다 — MCP 서버**. 6월 문서엔 없던 항목이고, 자체호스팅인 또박또박에 가장 잘 맞는다.

---

## 2. 6/18 → 7/27 구현 델타 (코드 실측)

**경쟁 갭 항목 구현: 0건.** grep 결과 `MeetingAnalyticsService`·번역·webhook·`ApiToken`·chapter·`Comment`/`Mention`·자막 익스포터 전부 부재. `app/mailers/`는 `application_mailer.rb` 스캐폴드만.

그 사이 머지된 것 중 **갭 지형을 바꾼 것 2건**:

| 머지 | 갭에 미친 영향 |
|---|---|
| #44 `MeetingCollaborator`/`FolderCollaborator` + `editable_by?` (cdf6e8d1) | 6월 ⑩(트랜스크립트 코멘트·@멘션)의 배관 비용 하락. 6월 앵커는 `ProjectMembership`이었는데, 이제 회의·폴더 단위 협업자 모델이 @멘션 후보 풀로 그대로 쓰인다 → **Tier2 안에서 승격** |
| #39 마크다운 내보내기 (`markdown_exporter.rb`) | 출력 카테고리 일부 해소. 자막(SRT/VTT) 판단(6월 ②)은 그대로 — 영상 없으면 수요 0 |

**6월 앵커 검증 2건** (advisor 지적분):
- ③ 액션아이템 — 6월 주장 "`save_action_items`가 `assignee_hint`/`due_date_hint`를 버린다" = **사실 확인**. `meeting_finalizer_service.rb:26-34`가 `content`/`status`/`ai_generated`만 저장, 프롬프트(`llm_prompts/summarization_prompts.rb:13,26`)는 두 hint를 이미 추출 중. 라인번호만 :45→:26으로 정정.
- ① 발언 점유율 — 프론트 포함 재확인, `frontend/src` 전체에 talk-time/analytics 구현 **없음**.

---

## 3. 6월 조사엔 없던 신규 신호 (2026 상반기)

### 🔴 신규 카테고리 — MCP 서버 (또박또박 0)

| 제품 | 시점 | 내용 |
|---|---|---|
| Granola | 2026-02 | MCP 서버 + personal API(Business)·enterprise API |
| Otter | 2026-04-28 | AI Chat Connectors = **양방향**. MCP **클라이언트**(Gmail·Drive·Notion·Jira·Salesforce를 챗으로 끌어옴) + MCP **서버**(ChatGPT·Claude가 회의 히스토리 조회) |
| Fireflies·Fellow·MeetGeek·Krisp | 2026 | "외부 AI 에이전트용 MCP" 카테고리로 정착 |

6월 문서 ⑫는 이 영역을 **웹훅+REST PAT**로 잡았다. MCP는 그걸 대체하는 게 아니라 **⑫의 토큰 절반을 전제로 얹히는 층**이다:

- 또박또박은 하이브리드 검색(KURE 임베딩+FTS5 RRF)·폴더/프로젝트 스코프 컨텍스트(`folder_chat_context.rb`)·인가 필터(`accessible_by`) 보유 → **MCP 툴 어댑터 자체는 얇다**.
- 하지만 인증이 없다. `ApiToken` 부재 실측 확인이고, `jwt_service.rb`의 JWT는 세션 스코프·만료형이라 장수명 MCP 연결에 부적합 → **`ApiToken`(token_digest·scopes·expires) + Bearer 미들웨어가 선행 조건**. 이 때문에 effort는 M이 아니라 **M~L**.
- 남는 후순위 = 웹훅 딜리버리·공개 REST 표면. Otter도 MCP를 API 표면 **대신**이 아니라 **함께** 냈다.
- 대가로 얻는 포지션: 자체호스팅 = 클라우드 경쟁사가 못 파는 "데이터는 내 서버에 둔 채 Claude/ChatGPT가 질의".

### 🟠 리더가 출시하며 승격된 항목

- **사전 회의 브리프** — Granola `Briefs`(2026-05-20, Mac/Win): 회의 참여 순간 직전 맥락 브리핑. 6월엔 ❌목록의 한 줄이었는데 리더가 실출시. 또박또박은 `이전 회의 참고`+`안건 첨부`+폴더 RAG 보유 → 조합만 하면 됨.
- **번역 (6월 ⑤ 강화)** — Zoom 2026-05-18 **Translator API + Summarizer API**(9개 언어, 서드파티 호출 가능), Voice Translator에 "내 목소리를 번역해 상대에게 재생"(백엔드 업데이트 2026-07-27 예정). 번역이 부가기능→API 표면으로 승격.
- **음성 호출 회의 에이전트** — Otter Meeting Agents(회의에 직접 참여해 질의응답·태스크 수행), Zoom `@Zoomie`(멘션/음성 명령으로 액션아이템·룸 설정, 2026-06). 6월 ⑨(라이브 in-meeting 어시)의 상위 단계.
- **녹음 고지·동의** — tl;dv 봇프리 데스크톱 녹음 + 동의 수집 내장(GDPR/APPI), Granola `Heads Up` 조직 전체 녹음 고지(2026-04 파일럿). 6월엔 "거버넌스 번들" 안에 묻혀 있었으나 이제 **독립 제품 기능**. 국내는 통신비밀보호법 이슈와 직결.

### 🟡 한국 시장 (6월 조사가 서구 편중이었던 부분)

- **클로바노트 화자 자동 식별** — ⚠️ 출처는 네이버웍스 **사전 안내 공지(2026-03-04 게시, 2026-04 정기 업데이트 적용 예정)**. 오늘(7/27) 기준 실출시 여부는 **미확인**. 내용은 화자 분리를 넘어 **화자 신원 자동 식별**(관리자 on/off 토글 제공).
  또박또박 실측: 화자 이름은 **완전 수동** — `speakers_controller#update`가 사이드카 `rename_speaker` 호출 + `transcripts.speaker_name` 갱신뿐, 참석자·명함 데이터와의 자동 매칭 코드 0. 명함 OCR 참석자 명단·도메인 용어·이전 회의 화자 이력이 있어 **LLM 문맥 추론 매칭**(음성 지문 없이 1차)이 가능. 국내 직접 경쟁자가 선행 예고한 유일 지점이라 패리티 방어 후보이나, **긴급도는 실출시 확인 후 판정**.
- 다글로 16개 언어 받아쓰기 — 번역/다국어 수요 재확인.
- Granola Android(2026-07-01) — 또박또박은 이미 모바일 보유(백그라운드 FGS 녹음까지). **우위 유지 확인**.

---

## 4. 갱신 우선순위 (6월 §10 대비 재정렬)

| # | 항목 | 6월 대비 | effort | 근거 |
|---|---|---|---|---|
| 1 | **MCP 서버 + `ApiToken`**(읽기 전용부터: 회의검색·요약조회·액션아이템) | **신규**(6월 ⑫ PAT 절반 포함) | M~L | 검색·인가 인프라 재사용. 자체호스팅 유일 포지션. 사용자 본인이 Claude Code 상시 사용 = 즉시 효용 |
| 2 | **발언 점유율/분석**(6월 ①) | 유지 1순위 | S | 순수 후처리, DB 변경 0, 신규 비용 0 |
| 3 | **액션아이템 배선**(6월 ③) | 유지 | S~M | hint 폐기 실측 확인. `my_open` 뷰까지 |
| 4 | **화자 자동 식별**(참석자 매칭) | **신규**(국내 패리티, 실출시 미확인) | M | 클로바노트 예고. 명함 OCR·참석자 명단 재사용 |
| 5 | **사전 회의 브리프** | ❌목록 → 승격 | M | Granola 실출시. 이전회의참고+안건+RAG 조합 |
| 6 | **번역 KR↔EN**(6월 ⑤) | 유지·강화 | M | Zoom API화. 글로사리=보존어 맵 |
| 7 | **녹음 고지·동의 UI** | 묻힘 → 독립 | S | 통신비밀보호법. 회의 시작 배너+참석자 고지 기록 |
| 8 | **트랜스크립트 코멘트·@멘션**(6월 ⑩) | 승격(비용 하락) | M | #44 협업자 모델이 멘션 풀 |

6월 §10의 나머지(⑦챕터분할·⑧이메일배포·⑫웹훅/PAT·⑬에이전트워크플로·⑯거버넌스 등)는 **판단 그대로 유효** — 그 문서 참조.

---

## 5. 이번 조사의 한계

- 소스 8콜 규모. Fireflies·Fathom·Avoma·Sembly **공식 체인지로그 직접 확인 실패**(404·SEO 결과) → 2차 출처 기반.
- 6월 문서가 미커버로 남긴 tl;dv·Lilys 세부는 이번에도 부분만 커버.
- "미발견 = 없음"이 아님. 6월 §5의 검증 프롬프트 편향 주의 그대로 적용.

## 6. 출처

- Otter AI Chat Connectors/MCP·Meeting Agents — otter.ai/blog (2026-04-28, primary)
- Granola Updates(Briefs 2026-05-20, Android 2026-07-01) — granola.ai/docs/changelog (primary)
- Granola MCP 서버(2026-02)·personal/enterprise API·Heads Up 파일럿 — bluedothq.com/blog/granola-review, techcrunch.com/2026/03/25 (2차)
- Zoom Translator/Summarizer API(2026-05-18)·Voice Translator·@Zoomie — news.zoom.com, bluente.com, releasebot.io (혼합)
- 클로바노트 화자 자동 식별 — naver.worksmobile.com/notice/96944 (primary, **직접 fetch**. 2026-03-04 게시 사전 안내 / 2026-04 적용 예정. 실출시 미확인)
- tl;dv 봇프리+동의 수집, Granola Heads Up — tldv.io/blog·bluedothq (2차, **미fetch·검색 요약 기반**)

**fetch 등급**: 직접 WebFetch = Otter 블로그, Granola docs/changelog, 네이버웍스 공지. 나머지는 검색 엔진 요약 기반(2차).
- MCP 카테고리 정착 — meetingnotes.com/blog/ai-meeting-notes-with-mcp-and-ai-agent-integration (2차)

# SDD ledger — plan: tasks/second-brain-api/design.md

BASE: 0c248a8776c8a8683215f27fe53644e568fc1540 (branch feature/second-brain-api)
Spec 권위: tasks/second-brain-api/design.md (requirements.md의 킥오프 결정 반영, 사용자 승인: 결정 7건 + 설계 §1·§2)

## 사전 충돌 스캔 (파일·인터페이스 공유 쌍)

| 쌍 | 공유 지점 | 발견 | Ruling |
|---|---|---|---|
| A×B/C/D/F | config/routes.rb | 4개 태스크가 라우트 추가 필요 → 병렬 편집 레이스 | Ruling: routes.rb는 A만 편집. A가 ext v1 전체 라우트(읽기·쓰기·검색)와 내부 api_tokens CRUD·skill_package 라우트를 계약(설계 §2·§3·§4)대로 선생성. B/C/D/F는 라우트 무편집 — 틀리면 라우트-컨트롤러 불일치 rspec에서 검출 |
| A×B/C/D | ext_accessible_by 스코프 | B·C·D 모두 소비, B 소유 시 C·D가 대기 필요 | Ruling: Meeting.ext_accessible_by(user)를 A로 이관(기반 취급). B·C·D는 소비만 — 틀리면 A 수정 재리뷰 비용 |
| A×E | 내부 api_tokens CRUD JSON 계약 | E가 A 완료 전 병렬 시작 | Ruling: 계약 = 설계 §1(필드 목록)+§5. E는 계약 기준 구현, G(통합)에서 실응답 대조 — 틀리면 필드명 정합 수정 비용 |
| B×D | 회의 serializer 재사용 | D 생성 응답이 B serializer에 의존하면 레이스 | Ruling: D의 쓰기 응답은 최소 자체 형태({id,status} 수준)로 독립 — 중복 최소화보다 병렬성 우선 |
| D 단독 | TranscriptRedactionService 확장 | 내부 핵심 서비스 수정 | Ruling: source='ext_api' Block 삭제 1건만 추가, 기존 검증 로직 무변경 |
| F×API 계약 | CLI가 실제 응답과 불일치 위험 | F는 계약 문서 기준 선작성 | Ruling: G에서 실제 라우트·응답과 대조 검증 후 교정 |
| Gemfile | A(rack-attack)·F(zip) | 병렬 편집 레이스 | Ruling: Gemfile·Gemfile.lock은 A만 편집(rubyzip 포함). F는 gem 추가 금지(zip 생성은 A가 추가한 rubyzip 사용, 혹은 시스템 zip 불가 시 보고) |
| 전체 | 같은 워킹트리 병렬 커밋 | add 레이스(실사고 2건 이력) | Ruling: 전 구현자 git add 금지·pathspec 커밋 강제, 브리프에 명기 |

물결 구성: wave1 = A·E·F 병렬 → wave2(A 완료 후) = B·C·D 병렬 → G 최종 리뷰.

## 진행
[wave1] impl-A/E/F 디스패치 (sonnet). BASE 0c248a87.
Ruling: B×D 파일 충돌 발견(ext MeetingsController 공유) → 쓰기 라우트를 meeting_writes/meeting_notes 컨트롤러로 분리, impl-A에 라우트 보정 전달 — 틀리면 라우트 재작업 비용 소.
[wave2 준비] task-B/C/D-brief.md 작성 완료. A 완료 시 즉시 병렬 디스패치.
Task F: 구현 DONE_WITH_CONCERNS (commits d2bb2ab6, 8d3db207). 우려 triage: 라우트 위치·인증 이원화=설계 의도 부합, 실응답 대조=G로 이관. minor (deferred): routes.rb 209행 stale 주석("컨트롤러는 아직 없음").
Task E: 구현 DONE (commit 2b79a7a5). tsc 0·vitest 2119 pass. 우려 triage: expires_at 포맷 대조=G로 이관, 개인설정 탭 배치=설계 의도 부합. minor (deferred): AiChatPanel.test.tsx 사전 존재 uncaught exception 로그(이번 변경 무관).
[review] review-E/review-F 디스패치 (sonnet, 커밋 스코프 패키지).
Task E: complete (commit 2b79a7a5, review clean — Approved). minor (deferred): token_prefix 마스킹 표시 포맷 통합 확인 / 모달 backdrop·Esc 미대응(안전 방향이라 수용). ⚠️→G: expires_at YYYY-MM-DD 포맷 백엔드 수용 여부, project_ids/folder_ids 미전송=무제한 해석 여부.
Task F: 리뷰 Approved(Spec ✅) + Important 1건(upload-audio Content-Type 고정) → fix round 1 시작(impl-F 재개). minor (deferred): skill_packages_spec의 무의미한 login_as/let!(:user) / CLI main()이 ApiError 외 파일 오류 미포장 / Retry-After HTTP-date 형식 ValueError 위험. ⚠️→G: CLI 응답 스키마 실대조.
Task F: fix round 1/5 (1 addressed, 0 open — Content-Type 추정 수정; commit 8f5b77f). 재리뷰 ADDRESSED·새 파손 없음.
Task F: complete (commits d2bb2ab6..8f5b77f, review clean, minor 3건 deferred)
Task A: 구현 DONE (commit 00f7cda, 신규 38 + 전체 rspec 2691 green). 판단지점 triage: 라우트 scope("/api") 정정=수용, kept 재적용=수용(휴지통 노출 차단), rubyzip 기존재=브리프 착오 확인.
Ruling: ext_accessible_by가 프로젝트 비멤버 협업자를 포함하는 것 수용 — 단건 인가·editable_by?와 동치화가 정본 통일 목적이며 idea-44 협업자 의미론과 일치 — 틀리면 외부 API 노출 범위 축소 재작업 비용.
[wave2] impl-B/C/D 디스패치 (sonnet) + review-A 디스패치 (opus).
Task A: 리뷰(opus) Needs fixes — Critical 0, Important: require_scope! 가드 아님 / rack-attack 무작위 Bearer 버킷 분산 우회 / scoped_meetings·require_scope! 검증 공백 / Devise 헬퍼 상속 오용 위험(동반 권고). fix round 1 시작(impl-A 재개).
Ruling: project_ids/folder_ids 빈 배열 []=nil과 동일한 무제한으로 정규화 — E UI가 미전송 방식이라 실사용 충돌 없음 — 틀리면 제한 의미론 재정의 비용 소.
Task A minor (deferred): attr_reader public 노출 / rate_limit 스펙 enabled 원복 누락 / 내부 404 SQL 스코프 노출(사전 존재 관례) / 사용자 삭제 시 감사 로그 연쇄 삭제 / 401 미감사(구조적) / collaborator_inherited_folder_ids kept 비대칭(안전 방향) / 폴더 전수 로드 비용(조건부) / Bearer 대소문자 구분 / ParameterMissing rescue_from 부재 / 토큰 개수·만료 상한 없음. ⚠️→G: solid_cache increment 실동작(rate limit 실환경).
Ruling: 병렬 전체 rspec 3개가 같은 SQLite 테스트 DB 공유 → 잠금 경합 산발 실패 위험(impl-C 보고). 태스크별 게이트를 "소유 스펙+직접 관련 영역(ext 전체, D는 redaction 스펙 포함) green"으로 완화, 권위 전체 회귀는 G 단계 단일 실행 1회로 대체 — 틀리면 교차 회귀를 G에서야 발견하는 지연 비용.
Task C: 구현 DONE (commit 9c0b232, 소유 10건 green + ext 79건 중 78 green — 실패 1건은 A 소유 rate_limit_spec의 SQLite locked, 경합/실결함 여부 A 재검증·G에서 확인 필요). 우려: vector_used 의미 부정확(스코프 0건 시) / pluck 바인드 상한 위험 — 리뷰어 판단에 위임.
[review] review-C 디스패치 (sonnet).
Task C: 리뷰 Approved(Spec ✅). Ruling: pluck(:id) IN 전개의 SQLite 바인드 상한 리스크는 plan-mandated+기존 코드 동형이므로 수용, 후속 티켓(서브쿼리 전환, SearchService 선례) — 틀리면 대량 회의 조직에서 검색 500. minor (deferred): 스코프 0건 시 vector_used true 오표시 / project_id·folder_id 필터 파라미터 테스트 공백 / 요약 검색 summary_type 무구분(제품 결정 사안).
Task C: complete (commit 9c0b232, review clean, 1 ruling + minor 3 deferred)
Task D: 구현 DONE (commit 6e7fa73, 소유+redaction 163 examples 0 failures). Ruling: audio 업로드는 전사 없는 회의 한정(422) 수용 — FileTranscriptionJob sequence 재부여 제약, 사후 첨부는 후속 정책 — 스킬 문서 정합은 G에서 대조. create의 folder_ids 제한 403 추가 수용.
[review] review-D 디스패치 (sonnet).
Task D: 리뷰 Needs fixes — Critical 0, Important: folder_id 조용한 폐기(422로 거부해야) / folder_ids 토큰 제한 create 분기 무검증. fix round 1 시작(impl-D 재개). 잠금 가드 409 채택(내부는 403이지만 브리프 계약 우선) 확인됨. minor (deferred): ext_api 매직 스트링 이원화(절단 보증 직결이라 최종 리뷰 triage 후보) / audit! 시점 비일관 / audio audit! 파일쓰기 선행 기록.
Task D: fix round 1/5 (2 addressed, 0 open — folder_id 422 명시 거부+주석 정리 / folder_ids 제한 스펙 3건; commit bc131a9). 재리뷰 ADDRESSED·새 파손 없음.
Task D: complete (commits 6e7fa73..bc131a9, review clean, minor 3 deferred)
Task A: fix round 1/5 (4건 반영 주장 — raise 방식 require_scope!/IP 버킷 300분+HEAD 교정/base_controller_spec 신규/[]→nil 정규화+Devise 헬퍼 undef 차단; commit e87d21a, 게이트 120건 green). rereview-A1(sonnet) 디스패치.
Task B: 구현 DONE (commit 3b0fbfe9, ext 79건 green, require_scope! 신계약 호환 확인). Ruling: projects/folders에 admin 우회 미적용 수용(노출 축소 방향, 회의 접근은 ext_accessible_by가 담당) / 폴더 목록 토큰 제한 확장 수용 / from-to 관대 파싱·부재 folder_id 빈 결과는 minor(문서화 대상). [review] review-B 디스패치 (sonnet).
Task A: fix round 1/5 (4 addressed, 0 open; commit e87d21a). 재리뷰(sonnet) 전건 ADDRESSED·새 파손 없음. undef 차단의 B/C/D 충돌 가능성은 G 전체 회귀로 최종 확인.
Task A: complete (commits 00f7cda..e87d21a, review clean, minor 10 deferred)
Task B: 리뷰 Approved(with follow-up) — Important 1건(meetings#index folder_id 필터 인가 비대칭, 실유출 없음 확인)을 즉시 fix round 1로 처리(impl-B 재개). minor (deferred): admin PAT의 projects/meetings 비대칭(문서화 대상) / per_page 비수치 입력 시 1로 clamp(기본 20 의도와 상이) / 부재 folder_id 빈 결과 전용 스펙 없음(fix round에서 함께 고정).
Task B: fix round 1/5 (1 addressed — folder_id 필터 project_ids 인가+스펙 2건; commit 8d811015). 재리뷰 ADDRESSED·새 파손 없음.
Task B: complete (commits 3b0fbfe9..8d811015, review clean, minor 3 deferred)
[G] 전 태스크 완료. 최종 전체 브랜치 리뷰(opus) 디스패치 + 전체 rspec 결과 대기 + 서버 스모크 예정.
[G] 프론트 게이트 green(tsc 0·vitest 2119 pass·exit 0, Errors 12는 사전존재 로그). 백엔드 전체 rspec 1차: 2777건 중 3건 실패 → 병렬 실행이 남긴 테스트 DB 오염 확증(db:test:prepare 후 해당 32건 전부 green). 깨끗한 DB로 전체 재실행 중(백그라운드).
[G] 최종 리뷰(opus) 판정: 수정 후 병합. Critical 2(admin PAT 읽기범위 초과·CLI 응답봉투 불일치 5커맨드) + Important(ext_api 상수 이원화·Retry-After 미전송·제한 UI 부재) + 문서(audio 422 제약·422 코드군·SKILL 검색 필드). 병합 전 필수 4건+α를 final-fix 단일 에이전트로 디스패치(sonnet, final-fix-brief.md).
Ruling: E의 프로젝트/폴더 제한 발급 UI 부재는 브리프가 의도한 생략(설계→브리프 드리프트를 오케스트레이터가 유발) — "알려진 미구현"으로 수용, 후속 티켓 — 틀리면 웹 발급 토큰 전부 무제한 범위 유지.
Ruling: Retry-After는 후속 분류였으나 서버 1줄+스펙 1건으로 문서를 참으로 만드는 쪽을 선택, 수정 물결에 포함.
[G] 권위 전체 회귀 green: 깨끗한 DB 전체 rspec 2779 examples 0 failures (final-fix 커밋 전 HEAD 기준). final-fix 반영 후 영향 스펙 단독 재확인 예정.
[G] final-fix 재리뷰: 6건 중 5건 완전 ADDRESSED. 4번 Retry-After는 헤더·스펙 존재하나 잔여시간 계산이 항상 period(60s) 반환(과대추정, 무해).
Ruling: Retry-After 정밀 계산 결함 park — 안전 방향 과대추정이라 기능 장애 없음, 정밀화(period - epoch_time%period + 1)는 후속 티켓 — 틀리면 클라이언트가 최대 60초 과대기. minor (deferred): 422 표에 invalid_content·invalid_meeting 누락.
[G] 코드 리뷰 절차 종료. 서버 스모크 테스트 시작.
[G] 서버 스모크 완료: me/projects/meetings/meeting/transcript/summary/search/create(빈 전사)/note/notes GET/dump 전부 정상. 경계 검증: 무토큰 401·스코프 밖 404·폐기 토큰 401. 감사 로그 15건 기록 확인. 잔재 정리(회의 308 삭제·토큰 폐기·서버 종료).
smoke minor (deferred): 전사 화자 null 시 "None" 표기 / CLI SIGPIPE 노이즈 / CLI에 notes 읽기 서브커맨드 부재(엔드포인트는 정상).
[G] 완료. 브랜치 feature/second-brain-api, 미머지·미푸시. 최종 요약 전달.

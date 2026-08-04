[2026-08-03 08:30] [WORKER] src-invite(sonnet) 또박 초대 기능 전수조사 완료 — 스키마·API·UI·엣지케이스 11건 확보
[2026-08-03 08:30] [WORKER] tgt-dflow(sonnet) wbs-web 통합 지점 조사 완료 — project_roles가 목표 테이블, share_token 선례, middleware matcher 함정
[2026-08-03 08:35] [ACTION] tgt-dflow에 후속 5건 질의 (memberships 스키마·settings 구조·matcher 원문·projects 스키마·isShareToken/테스트 템플릿)
[2026-08-03 08:50] [ACTION] 스펙 초안 작성 완료 (artifacts/dflow-project-invite-spec.md) — 설계 결정: uuid 토큰(share_token 선례), project_roles 목표, 원본 결함 2건(TOCTOU·기존멤버 소비) 수정, team_id는 생성자 팀
[2026-08-03 08:52] [WORKER] spec-verify(세션 최상위) 적대 검증 파견 — 유령참조·막힘지점·설계결함·SQL·마이그레이션 순번
[2026-08-03 09:20] [VERIFICATION] spec-verify 적대 검증: CRITICAL 2(consume 함수 grant 누락, supabase-js on-conflict API 부재→upsert+ignoreDuplicates로 정정)·MAJOR 6(로스터 트리거 오해, 테이블 GRANT 회수, server-only 거짓 전제, Actor.teamId nullable, createServerClient async, 소비 후 부분실패)·MINOR 12 — 전건 스펙 반영 완료. 통과 항목: 스키마·가드·matcher·SectionCard·테스트 관례 전부 실측 일치. 마이그레이션 순번 0055 확정
[2026-08-03 09:25] [ACTION] kickoff-prompt.md 작성 (D'Flow 세션 붙여넣기용, T1~T8 모델 지정 포함). status → done
[2026-08-03 09:40] [ACTION] kickoff-prompt.md /loop 기반으로 재작성 (사용자 요청). /goal 스킬은 전역·wbs-web·내장 어디에도 없음 확인 — /loop(자율 페이스) 채택. 진행상태 파일(docs/superpowers/progress-project-invite.md) 기반 반복·태스크당 1반복·T8 통과 시 자체 종료 구조
[2026-08-03 10:05] [ACTION] 통합 단일 문서 project-invite-spec.md 생성 (착수 지시문+스펙 결합, 절대경로 제거, 다른 PC 이동용). 저장 위치 지시 = wbs-web docs/project-invite-spec.md
[2026-08-03 10:20] [ACTION] 전달물 2파일 체계로 재편 (사용자 요청: 지시문 분리). project-invite-spec.md=스펙 단독(경로 일반화), kickoff-prompt.md=이식형 지시문(docs/ 상대경로). 구본 dflow-project-invite-spec.md 삭제(내용은 project-invite-spec.md와 동일)

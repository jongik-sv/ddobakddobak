# Decisions Log — feature: idea-44-meeting-collaborators

> Append-only audit trail of autonomous decisions made during DDTR/feat/wbs cycles.
> Edit prior entries forbidden — record reversals as new entries instead.

## D-001 (2026-07-23T06:43:12Z)
- **Phase**: feat-intake
- **Decision needed**: 다중 편집자 부여 방식 + 상속 범위
- **Decision made**: kind=feature, acceptance=단위테스트 통과, scope=[backend,frontend,database/migration], constraints=기존 API(editable 필드) 호환 유지; 협업자는 meeting_collaborators + folder_collaborators 2테이블, 폴더→회의 실시간 상속(스냅샷 아님, ancestor_records 재사용)
- **Rationale**: AskUserQuestion 3라운드: 옵션A/B/C 중 B(회의별 협업자) 선택 후, 유저가 폴더 단위 지정+상속 요구 추가, 상속은 실시간(기존 effectively_shared? 패턴과 일관) 선택
- **Reversible**: yes

## D-002 (2026-07-23T07:06:47Z)
- **Phase**: design
- **Decision needed**: spec가 명시하지 않은 인가 게이트 확장 범위(읽기 게이트 포함 여부), 협업자 CRUD 자체의 권한 경계, editable_by? 확장이 destroy/lock/shared까지 포괄하는지
- **Decision made**: (1) authorize_meeting_read!에도 협업자 분기 추가(제어 게이트만으론 비공유 회의에서 403이 먼저 발생해 기능 자체가 동작 안 함) (2) 협업자 추가/제거는 authorize_meeting_control!이 아닌 전용 좁은 게이트(소유자+admin, authorize_meeting_collaborator_admin!)로 분리 — 권한 상승 방지 (3) editable_by? 확장은 destroy/lock/shared 토글까지 균일 적용, 단 클래스 레벨 스코프 Meeting.editable_by(벌크 액션용)는 소유자 전용 유지
- **Rationale**: set_meeting이 모든 액션에 authorize_meeting_read!를 선실행하는 기존 구조 확인, 재사용 시 협업자가 협업자를 늘릴 수 있는 권한상승 시나리오 식별, meeting_json.editable 단일 필드가 이미 4개 어포던스(편집/삭제/잠금/공유토글)를 겸하고 있어 API 호환성 제약(spec) 상 분리 불가
- **Reversible**: yes
- **Source**: docs/features/idea-44-meeting-collaborators/design.md

## D-003 (2026-07-23T07:20:05Z)
- **Phase**: build
- **Decision needed**: design.md 9지점 목록이 canEdit 미배선의 전체 범위를 정확히 반영하는가
- **Decision made**: meetingDetailTabs.tsx의 TranscriptPanel/AiSummaryPanel, MeetingPage.tsx의 TranscriptPanel/AiSummaryPanel, MeetingLivePage.tsx의 데스크톱 MeetingEditor(line 419)까지 5개 지점을 수정 범위에 추가(design.md 9지점 + 5)
- **Rationale**: design.md은 이 두 패널 호출부가 이미 canEdit을 반영한다고 명시했으나 코드 직접 확인 결과 거짓임(buildMeetingDetailTabs에 canEdit 파라미터 자체가 없고, 두 패널 모두 locked만 체크). idea 44 핵심 버그(비소유자가 편집 가능한 것처럼 보이다 서버 403으로 저장 실패)가 design 목록만 고치면 Transcript·AI요약 편집에서 여전히 재현됨
- **Reversible**: yes
- **Source**: build-subagent

# 회의 접근 제어 설계 (소유자 기반 + 공유코드 뷰어)

- 날짜: 2026-05-27
- 상태: 설계 승인됨 (구현 계획 대기)

## 1. 문제

현재 로그인한 어떤 계정이든 **모든 회의가 목록에 보이고**, URL/ID로 **아무 회의나 직접 열 수 있다.** 회의 접근에 소유자/권한 개념이 강제되지 않는다.

근거(코드):
- `app/controllers/api/v1/meetings_controller.rb:10` — `index`가 `Meeting.search_with_summary(params[:q])`로 **전체 회의** 반환 (current_user 스코프 없음).
- `MeetingLookup#set_meeting` (`app/controllers/concerns/meeting_lookup.rb`) — `Meeting.find(id)`만 하고 인가 없음. 8개 컨트롤러가 공유.
- 공유 인프라는 이미 존재: `MeetingShareService#join_meeting(code, user)`가 `MeetingParticipant`(host/viewer)를 영구 등록, `Meeting#owner?(user)`, `active_participants`, `host_participant` 등.

## 2. 목표 / 비목표

**목표**
- 회의는 **소유자(`created_by`)** 만 직접 입장(호스트).
- 비소유자는 **공유코드로만** 뷰어 참여 가능.
- **백엔드에서 강제**: 목록 스코프 + 개별 접근 인가(403). URL 직접 접근도 차단.

**비목표(이번 범위 밖)**
- 목록에 "내가 뷰어로 참여한 회의" 표시 (기본 미포함).
- 팀/조직 단위 공유, 역할 세분화(편집자 등).
- 기존 in-session 호스트 위임/자동승격 로직 재설계 (현행 유지).

## 3. 접근 권한 모델

| 액션 유형 | 소유자(`created_by`) | active host participant | active viewer participant | 그 외 |
|---|---|---|---|---|
| 목록(index)에 노출 | ✅ (소유분만) | — | ❌(기본) | ❌ |
| 읽기 (show/transcripts/summary/export/feedback/bookmarks/decisions/blocks/audio 조회) | ✅ | ✅ | ✅ | ❌ 403 |
| 제어 (update/destroy/start/stop/reopen/reset_content/summarize/update_notes/regenerate_*) | ✅ | ✅ | ❌ 403 | ❌ 403 |
| 공유 관리 (share/revoke/transfer) | ✅ (기존 `ensure_host!` 유지) | ✅ | ❌ | ❌ |

"읽기 허용 = 소유자 OR active participant", "제어 허용 = 소유자 OR 현재 host participant".

## 4. 백엔드 설계 (Rails)

### 4.1 목록 스코프
`MeetingsController#index`: 시작 쿼리를 **현재 사용자 소유분**으로 한정.
- `Meeting.search_with_summary(params[:q]).where(created_by_id: current_user.id)` (또는 `current_user.created_meetings` 연관). 이후 status/folder/date 필터는 그대로 체이닝.
- 검색(`search_with_summary`)도 소유분 내에서만.

### 4.2 읽기 인가 (공통 1곳)
`MeetingLookup`에 인가 헬퍼 추가 후, `set_meeting` 직후 실행:
```
def authorize_meeting_read!
  return if current_user.respond_to?(:admin?) && current_user.admin?  # 채널과 동일하게 admin 우회
  return if @meeting.owner?(current_user)
  return if @meeting.active_participants.exists?(user_id: current_user.id)
  render json: { error: "이 회의에 접근할 권한이 없습니다" }, status: :forbidden
end
```
(제어 인가/목록 스코프도 동일하게 admin은 전체 접근 허용 — `TranscriptionChannel#determine_role`과 일관)
- `MeetingLookup`를 include하고 `set_meeting`을 before_action으로 쓰는 8개 컨트롤러(meetings, transcripts, meeting_attachments, meeting_bookmarks, meeting_action_items, meeting_decisions, meetings_audio, blocks)에 `before_action :authorize_meeting_read!` 추가(또는 set_meeting 내부에서 호출).

### 4.3 제어 인가 (소유자/호스트)
`MeetingsController`의 제어 액션에 한정한 추가 before_action:
```
before_action :authorize_meeting_control!, only: %i[update destroy start stop reopen reset_content summarize update_notes regenerate_stt regenerate_notes]
# 허용: 소유자 OR 현재 active host participant
```
- 읽기 액션(show/transcripts/summary/export/export_prompt/feedback)은 4.2만 적용.

### 4.4 커버리지 감사 (직접 노출 경로)
- `decisions_controller.rb:11` — `Meeting.all` 직접 사용 → `where(created_by_id: current_user.id)` 또는 접근 인가로 보정.
- `speakers_controller` — meeting_id 참조하나 `MeetingLookup` 미사용 → set_meeting + read 인가 적용 검토.
- `meeting_shares_controller` — 공유 생성/조인. 조인(join)은 **인가 예외**(코드로 진입하는 경로이므로 read 인가를 적용하면 안 됨). 공유 생성/revoke/transfer는 기존 host 검사 유지.

### 4.5 조인/참여자 재사용
- 기존 `MeetingShareService#join_meeting`을 그대로 사용. 코드로 들어오면 viewer participant가 등록되어 4.2의 인가를 통과.
- 정상 흐름: 소유자가 공유 시작(`generate_share_code`) → 소유자가 host participant로 등록 → 이후 조인자는 viewer. (기존 "활성 호스트 없으면 승격" 로직은 호스트 끊김 대비로 유지)

## 5. 프론트엔드 설계 (React)

### 5.1 목록
- 백엔드 스코프로 자동 해결 — 추가 작업 없음. (다른 계정엔 내 회의 안 보임)

### 5.2 비소유 회의 접근 = 공유코드
- 기존 진입점 재사용: 회의 목록의 "회의 참여"(데스크톱 버튼 / 모바일 상단 UserPlus 아이콘) → `JoinMeetingDialog` → `joinMeeting(code)` → `/meetings/:id/viewer`.
- `MeetingViewerPage`의 소유자 리다이렉트 로직 유지.

### 5.3 403 처리 (신규)
- 소유·참여하지 않은 회의 URL(`/meetings/:id`, `/live`, `/viewer`) 직접 접근 시 백엔드가 403 → 프론트에서 "접근 권한이 없습니다. 공유 코드로 참여하세요" 안내 후 `/meetings`로 이동.
- 적용 지점: `MeetingPage`, `MeetingLivePage`의 초기 `getMeeting`/`getTranscripts` 에러 핸들링에서 403 분기 (현재는 `.catch(() => {})`로 무시 → 분기 추가). `useViewerData`도 동일.

### 5.4 영향 없는 것
- 공유/뷰어/실시간 채널(TranscriptionChannel) 동작은 그대로.
- **WS 채널 인가는 이미 구현됨**: `TranscriptionChannel#subscribed`가 `determine_role`(owner/host/viewer만 `stream_from`, 그 외 `reject`)로 인가하고, viewer는 `audio_chunk` 전송 차단. → 채널은 변경 불필요. 이번 작업은 **REST 경로만** 보강.

## 6. 결정 포인트 (기본값)
1. 목록에 "내가 뷰어로 참여한 회의" 포함 → **미포함**(코드로만 접근).
2. 제어 액션 권한 → **소유자 + 현재 host participant**.

## 7. 엣지 케이스
- **ActionCable `TranscriptionChannel` 구독 인가**: 이미 `determine_role`로 owner/participant만 허용, 그 외 reject (변경 불필요). REST만 보강하면 WS는 이미 일관됨.
- **소유자 다중 기기**: 같은 소유자가 여러 기기에서 직접 입장 가능(둘 다 소유자). 라이브 녹음 단일 호스트 제약은 현행 유지.
- **기존 데이터**: 모든 회의에 `created_by` 존재 → 마이그레이션 불필요.
- **공유 중 소유자 이탈/호스트 위임**: 기존 동작 유지(viewer가 host로 승격 가능). 본 변경은 "읽기=참여자, 제어=호스트" 인가만 추가.

## 8. 테스트 계획
**백엔드 request spec**
- 비소유자 `index` 응답에 타 계정 회의 미포함.
- 비참여자가 `show`/`transcripts` 요청 → 403.
- viewer participant가 `show`/`transcripts` → 200, `start`/`update` → 403.
- 소유자 → 전부 200.
- `join_meeting` 후 같은 사용자 `show` → 200.
- (해당 시) TranscriptionChannel 구독 인가 spec.

**프론트**
- 403 응답 시 안내 + `/meetings` 리다이렉트(기존 단위 테스트 패턴 활용).

## 9. 배포 / 마이그레이션
- 백엔드(Rails) 변경 → **재배포 필요**.
- DB 마이그레이션 없음(기존 컬럼/모델 재사용).

## 10. 추후(별도)
- "참여한 회의" 목록/히스토리.
- 채널 구독 인가를 공통 정책으로 일반화.

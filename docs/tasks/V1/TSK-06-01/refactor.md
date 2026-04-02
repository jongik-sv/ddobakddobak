# TSK-06-01: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| backend/app/controllers/api/v1/meetings_controller.rb | `user_team_ids` private 메서드 추출 (index/set_meeting 중복 제거) |
| backend/app/controllers/api/v1/meetings_controller.rb | `pagination_page`, `pagination_per` private 메서드 추출 |
| backend/app/controllers/api/v1/meetings_controller.rb | `require_meeting_status!` 헬퍼 추출 (start/stop 중복 패턴 통합) |
| backend/app/controllers/api/v1/meetings_controller.rb | `create` 내 멤버십 확인을 `require_team_membership!` concern 메서드로 교체 |
| backend/app/controllers/api/v1/meetings_controller.rb | `meeting_json` 내 직렬화 로직을 `serialize_transcripts`, `serialize_summary`, `serialize_action_items`로 분리 |

## 테스트 확인
- 결과: PASS
- 38 examples, 0 failures

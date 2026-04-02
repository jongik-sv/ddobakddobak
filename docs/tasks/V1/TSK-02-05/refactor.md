# TSK-02-05: 리팩토링 내역

## 변경 사항
| 파일 | 변경 내용 |
|---|---|
| `app/models/meeting.rb` | `enum :status` 에서 불필요한 `prefix: false` 옵션 제거 (Rails 기본값) |

## 테스트 확인
- 결과: PASS
- 65 examples, 0 failures

# TSK-01-03 리팩토링 보고서

> date: 2026-04-02

---

## 수행한 리팩토링

### 1. DRY 위반 해소: `local_default_user` 중복 제거

**문제**: `User.find_or_create_by!(email: "desktop@local")` 로직이 3곳에 중복 정의되어 있었음.
- `DefaultUserLookup#default_user` (서버모드 가드 포함)
- `ApplicationController#local_default_user` (가드 우회용)
- `ApplicationCable::Connection#local_default_user`

**해결**: `DefaultUserLookup` concern에 `local_default_user`를 단일 정의하고, `ApplicationController`와 `Connection`에서 중복 메서드 삭제.

| 파일 | 변경 |
|------|------|
| `app/controllers/concerns/default_user_lookup.rb` | `default_user` + `raise_server_mode_error!` 제거, `local_default_user` 추가 |
| `app/controllers/application_controller.rb` | `local_default_user` 중복 정의 삭제 (concern에서 상속) |
| `app/channels/application_cable/connection.rb` | `local_default_user` 중복 정의 삭제 (concern에서 상속) |

### 2. 미사용 코드 제거

**문제**: `DefaultUserLookup#default_user`와 `raise_server_mode_error!`는 프로덕션 코드에서 호출되지 않았음. 서버모드 가드가 있는 `default_user`를 우회하기 위해 별도 `local_default_user`가 만들어진 구조.

**해결**: 불필요한 `default_user`, `raise_server_mode_error!` 제거. concern의 역할을 `server_mode?` 판단 + `local_default_user` 제공으로 명확히 정리.

### 3. 중복 rescue 제거 (Connection)

**문제**: `authenticate_websocket_user`에서 `JWT::DecodeError, JWT::ExpiredSignature`를 rescue하고 있었으나, 호출하는 `decode_jwt`에서 이미 동일 예외를 rescue하여 nil을 반환하므로 외부 rescue는 도달 불가능한 dead code.

**해결**: `authenticate_websocket_user`의 rescue 블록 제거.

### 4. 테스트 around 블록 중복 제거

**문제**: 3개 spec 파일에서 동일한 `ENV["SERVER_MODE"]` around 블록이 반복.

**해결**: `spec/support/server_mode_context.rb`에 shared context 추출.
- `include_context "local mode"` — SERVER_MODE=nil 설정
- `include_context "server mode"` — SERVER_MODE=true 설정

`rails_helper.rb`에 `spec/support/` 자동 로드 추가.

### 5. rails_helper.rb 정리

`login_as` 헬퍼에서 삭제된 `default_user`에 대한 stub 제거.

---

## 리팩토링 후 테스트 결과

```
$ bundle exec rspec spec/controllers/concerns/default_user_lookup_spec.rb \
    spec/requests/server_local_mode_spec.rb \
    spec/channels/connection_spec.rb

....................

Finished in 1.16 seconds
20 examples, 0 failures
```

전체 테스트 스위트도 통과:

```
$ bundle exec rspec

246 examples, 0 failures
```

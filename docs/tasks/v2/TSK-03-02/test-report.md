# TSK-03-02: 사용자별 LLM API 구현 - 테스트 리포트

**실행일:** 2026-04-02
**실행 환경:** Ruby 4.0.2 / Rails / RSpec

---

## 1. 테스트 실행 결과 요약

| 항목 | 결과 |
|------|------|
| 전체 테스트 수 | 290 |
| 통과 | 290 |
| 실패 | 0 |
| 실행 시간 | 47.16초 |

TSK-03-02 관련 테스트만 실행 시:

| 항목 | 결과 |
|------|------|
| 테스트 수 | 44 |
| 통과 | 44 |
| 실패 | 0 |
| 실행 시간 | 7.51초 |

**결과: 전체 테스트 통과 (실패 없음)**

---

## 2. 실패 테스트 원인 및 수정 내역

실패한 테스트 없음. 첫 번째 실행에서 전체 통과.

> 참고: `have_http_status(:unprocessable_entity)` 관련 Rack 경고가 출력되나 이는 Rack 최신 버전에서 `:unprocessable_entity`가 `:unprocessable_content`로 변경 예정이라는 deprecation 경고이며, 테스트 결과에는 영향 없음.

---

## 3. 테스트 커버리지 (시나리오별)

### 3.1 모델 테스트 (`spec/models/user_llm_spec.rb`) — 17개

| 카테고리 | 시나리오 |
|----------|----------|
| 마이그레이션 | `users` 테이블에 `llm_provider`, `llm_api_key`, `llm_model`, `llm_base_url` 컬럼 존재 확인 |
| API 키 암호화 | DB 저장 시 암호화, 읽기 시 복호화, nil 허용 |
| `#llm_configured?` | provider + api_key 모두 있으면 true, 한쪽 없으면 false, 둘 다 없으면 false |
| `#effective_llm_config` | 개인 설정 우선 반환, base_url 포함, 미설정 시 서버 기본값 폴백 |
| `.server_default_llm_config` | anthropic ENV 설정, openai ENV 설정, ENV 미설정 시 기본값 |
| 팩토리 트레이트 | `:with_llm_config`, `:with_openai_config`, `:with_custom_endpoint` 검증 |

### 3.2 API 통합 테스트 (`spec/requests/api/v1/user/llm_settings_spec.rb`) — 27개

#### GET /api/v1/user/llm_settings (3개)
| 시나리오 | 검증 내용 |
|----------|----------|
| LLM 미설정 사용자 | `configured: false`, 모든 필드 nil |
| LLM 설정된 사용자 | `configured: true`, provider/model 반환, api_key 마스킹 |
| server_default 정보 | `provider`, `model`, `has_key` 키 존재 확인 |

#### PUT /api/v1/user/llm_settings (9개)
| 시나리오 | 검증 내용 |
|----------|----------|
| LLM 설정 저장 | provider, api_key, model 저장 및 응답 확인 |
| api_key 빈 문자열 | 기존 키 유지 |
| api_key null | 키 삭제 (nil) |
| provider 빈값 | 전체 초기화 (모든 LLM 필드 nil) |
| provider null | 전체 초기화 |
| 잘못된 provider | 422 반환 |
| openai provider | 정상 허용 |
| base_url 설정 | 커스텀 엔드포인트 저장 |
| base_url 빈 문자열 | nil로 설정 |

#### POST /api/v1/user/llm_settings/test (9개)
| 시나리오 | 검증 내용 |
|----------|----------|
| 연결 테스트 수행 | 200 OK, success: true |
| Sidecar 파라미터 검증 | provider, model, auth_token 올바르게 전달 |
| api_key 미전송 | 저장된 키(`current_user.llm_api_key`) 사용 |
| base_url 전달 | Sidecar에 base_url 전달 |
| ConnectionError | 503 반환 |
| TimeoutError | 503 반환 |
| SidecarError | 503 반환 |
| provider 누락 | 400 Bad Request |
| model 누락 | 400 Bad Request |

#### API 키 마스킹 (3개)
| 시나리오 | 검증 내용 |
|----------|----------|
| 긴 키 (9자 이상) | 앞 4자 + 뒤 4자 표시, 중간 마스킹 |
| 짧은 키 (8자 이하) | `"****"` 전체 마스킹 |
| 미설정 | nil 반환 |

#### 미인증 요청 — 서버 모드 (3개)
| 시나리오 | 검증 내용 |
|----------|----------|
| GET 미인증 | 401 Unauthorized |
| PUT 미인증 | 401 Unauthorized |
| POST test 미인증 | 401 Unauthorized |

---

## 4. TSK-03-02에서 추가된 테스트 목록

### 신규 파일

| 파일 | 테스트 수 | 설명 |
|------|----------|------|
| `spec/models/user_llm_spec.rb` | 17 | User 모델 LLM 설정 필드, 암호화, 메서드, 팩토리 트레이트 |
| `spec/requests/api/v1/user/llm_settings_spec.rb` | 27 | LLM 설정 CRUD API + 연결 테스트 엔드포인트 통합 테스트 |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `spec/factories/users.rb` | `:with_llm_config`, `:with_openai_config`, `:with_custom_endpoint` 트레이트 추가 |

### 총 추가 테스트: 44개

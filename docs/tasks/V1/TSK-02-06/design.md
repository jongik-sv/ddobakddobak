# TSK-02-06: SidecarClient 서비스 구현 - 설계

## 구현 방향
Rails에서 Python Sidecar FastAPI 서버와 통신하는 HTTP 클라이언트를 구현한다.
Ruby 내장 `Net::HTTP`를 사용하여 외부 gem 의존성 없이 `/health`, `/transcribe`, `/summarize`, `/summarize/action-items` 엔드포인트를 호출한다.
타임아웃, 연결 오류, HTTP 에러를 커스텀 예외 클래스로 처리한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| `backend/app/services/sidecar_client.rb` | HTTP 클라이언트 서비스 | 신규 |
| `backend/spec/services/sidecar_client_spec.rb` | RSpec 단위 테스트 | 신규 |

## 주요 구조
- `SidecarClient` — 메인 클라이언트 클래스, `SIDECAR_HOST`/`SIDECAR_PORT` ENV 사용
- `SidecarClient::SidecarError` — HTTP 에러 응답 (4xx/5xx)
- `SidecarClient::TimeoutError` — Net::OpenTimeout/ReadTimeout 래핑
- `SidecarClient::ConnectionError` — 연결 실패 (ECONNREFUSED 등) 래핑
- `#with_connection` — Net::HTTP 세션 관리, 예외 변환 담당 private 메서드

## 데이터 흐름
호출자 → `SidecarClient#transcribe(audio_base64)` → POST /transcribe → JSON 파싱 → `{ "segments" => [...] }` 반환

## 선행 조건
- ENV: `SIDECAR_HOST` (기본값: localhost), `SIDECAR_PORT` (기본값: 8000)
- Sidecar API 스펙 (아직 구현 중, 스펙 기반으로 구현)

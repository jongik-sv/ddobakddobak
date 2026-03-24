# TSK-00-01: 리팩토링 문서

## 리팩토링 내용

### 1. ApplicationController 개선

공통 에러 핸들링 추가:
- `ActiveRecord::RecordNotFound` → 404 응답
- `ActionController::ParameterMissing` → 400 응답

향후 모든 컨트롤러에서 공통으로 활용할 에러 처리 기반 마련.

### 2. 코드 품질 확인 사항

- Health Controller: 단순하고 명확한 단일 책임 구조 유지
- CORS 설정: 개발 환경에서 localhost:5173만 허용 (최소 권한 원칙)
- Database PRAGMA: WAL 모드 및 busy_timeout 설정으로 SQLite 동시 쓰기 안정성 확보

## 리팩토링 후 테스트 결과

```
3 examples, 0 failures
Finished in 0.02524 seconds (files took 0.3543 seconds to load)
```

모든 테스트 통과 확인.

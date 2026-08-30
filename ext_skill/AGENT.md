# 또박또박(ddobak) 회의 API — 에이전트용 레퍼런스

이 문서는 Claude Code뿐 아니라 다른 LLM 에이전트(범용 도구 호출 에이전트, 코드
어시스턴트 등)가 또박또박 회의 API를 사용하기 위한 벤더 중립 레퍼런스다. 같은
디렉토리의 `scripts/ddobak_api.py`(파이썬 표준 라이브러리만 사용)를 실행해도 되고,
아래 계약을 참고해 직접 HTTP 요청을 구성해도 된다.

## 인증

Base URL: 환경변수 `DDOBAK_API_URL` (예: `https://10.110.2.175`)

모든 요청에 `Authorization: Bearer <DDOBAK_API_TOKEN>` 헤더를 붙인다. 토큰 형식은
`ddbk_...`이며 또박또박 웹앱의 "설정 → API 토큰"에서 발급한다.

## API 계약

| 메서드·경로 | 스코프 | 설명 |
|---|---|---|
| `GET /api/ext/v1/me` | — | 토큰·사용자·스코프·만료 확인 |
| `GET /api/ext/v1/projects` | `meetings:read` | 프로젝트 목록 |
| `GET /api/ext/v1/projects/:id/folders` | `meetings:read` | 폴더 트리 |
| `GET /api/ext/v1/meetings?project_id=&folder_id=&from=&to=&status=&page=&per_page=` | `meetings:read` | 회의 목록(페이지네이션 `meta` 포함) |
| `GET /api/ext/v1/meetings/:id` | `meetings:read` | 회의 상세 |
| `GET /api/ext/v1/meetings/:id/transcripts` | `transcripts:read` | 전사 전체(화자·ms) |
| `GET /api/ext/v1/meetings/:id/summary` | `summaries:read` | final 요약(`key_points`/`decisions`/`notes_markdown`) |
| `GET /api/ext/v1/search?q=&project_id=&folder_id=&limit=` | `search:read` | 하이브리드 검색(발췌 + 회의 참조) |
| `POST /api/ext/v1/meetings` | `meetings:write` | 텍스트 전사 임포트 회의 생성 |
| `POST /api/ext/v1/meetings/:id/audio` | `meetings:write` | 오디오 업로드(multipart `file`) → STT 큐 |
| `POST /api/ext/v1/meetings/:id/notes` | `meetings:write` | 에이전트 노트 append |
| `GET /api/ext/v1/meetings/:id/notes` | `meetings:read` | API로 남긴 노트 조회 |
| `POST /api/ext/v1/meetings/:id/summarize` | `meetings:write` | 요약 재생성 트리거(실행 중이면 409) |

### `POST /api/ext/v1/meetings` 요청 바디

```json
{
  "title": "주간 스탠드업",
  "project_id": 12,
  "folder_id": 34,
  "transcripts": [
    {
      "speaker_name": "김철수",
      "content": "지난 스프린트 진행 상황 공유드립니다.",
      "started_at_ms": 0,
      "ended_at_ms": 4200
    }
  ]
}
```

`folder_id`, `started_at_ms`, `ended_at_ms`는 선택 필드다.

### `POST /api/ext/v1/meetings/:id/notes` 요청 바디

```json
{ "content": "다음 회의 전까지 견적서 확정 필요" }
```

### 오류 응답

모든 오류는 `{"error": {"code": "...", "message": "..."}}` 형식이며, HTTP 상태 코드는
`401`(미인증) / `403`(스코프 부족) / `404`(대상 없음) / `409`(충돌, 예: 요약 재생성
중복 실행) / `429`(rate limit — `Retry-After` 헤더 참고) 중 하나다.

## curl 예시

```bash
# 토큰 확인
curl -sS "$DDOBAK_API_URL/api/ext/v1/me" \
  -H "Authorization: Bearer $DDOBAK_API_TOKEN"

# 회의 목록 (기간 필터)
curl -sS "$DDOBAK_API_URL/api/ext/v1/meetings?project_id=12&from=2026-08-01&to=2026-08-30" \
  -H "Authorization: Bearer $DDOBAK_API_TOKEN"

# 검색
curl -sS "$DDOBAK_API_URL/api/ext/v1/search?q=예산&project_id=12&limit=5" \
  -H "Authorization: Bearer $DDOBAK_API_TOKEN"

# 텍스트 전사로 회의 생성
curl -sS -X POST "$DDOBAK_API_URL/api/ext/v1/meetings" \
  -H "Authorization: Bearer $DDOBAK_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"주간 스탠드업","project_id":12,"transcripts":[{"speaker_name":"김철수","content":"..."}]}'

# 오디오 업로드
curl -sS -X POST "$DDOBAK_API_URL/api/ext/v1/meetings/456/audio" \
  -H "Authorization: Bearer $DDOBAK_API_TOKEN" \
  -F "file=@recording.m4a"

# 노트 추가
curl -sS -X POST "$DDOBAK_API_URL/api/ext/v1/meetings/456/notes" \
  -H "Authorization: Bearer $DDOBAK_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"다음 회의 전까지 견적서 확정 필요"}'

# 요약 재생성
curl -sS -X POST "$DDOBAK_API_URL/api/ext/v1/meetings/456/summarize" \
  -H "Authorization: Bearer $DDOBAK_API_TOKEN"
```

## CLI 예시(`scripts/ddobak_api.py`)

```bash
export DDOBAK_API_URL="https://10.110.2.175"
export DDOBAK_API_TOKEN="ddbk_xxxxxxxxxxxx"

python3 scripts/ddobak_api.py me
python3 scripts/ddobak_api.py projects
python3 scripts/ddobak_api.py folders 12
python3 scripts/ddobak_api.py meetings --project 12 --from 2026-08-01 --to 2026-08-30
python3 scripts/ddobak_api.py meeting 456
python3 scripts/ddobak_api.py transcript 456
python3 scripts/ddobak_api.py summary 456
python3 scripts/ddobak_api.py search "예산" --project 12 --limit 5
python3 scripts/ddobak_api.py create --title "주간 스탠드업" --project 12 --transcript-file ./transcript.json
python3 scripts/ddobak_api.py note 456 --content "다음 회의 전까지 견적서 확정 필요"
python3 scripts/ddobak_api.py summarize 456
python3 scripts/ddobak_api.py upload-audio 456 ./recording.m4a
python3 scripts/ddobak_api.py dump 456 --out ./notes
```

모든 서브커맨드는 `--json`을 붙이면 가공 없는 원본 JSON을 출력한다. 서버 오류는
`오류: <message>` 형태로 stderr에 출력되고 exit code 1로 끝난다.

## 페이지네이션·rate limit 처리 지침

- `meetings`, `search`는 결과가 많을 수 있다. 먼저 `--limit`/`--per_page`를 작게
  잡아 관련성을 확인한 뒤 필요할 때만 다음 페이지를 요청한다.
- `meetings` 응답의 `meta`에 페이지 정보가 담긴다. `meta.total_pages`가 현재
  `meta.page`보다 크면 다음 페이지가 남은 것이다.
- `429`를 받으면 응답의 `Retry-After` 헤더(초)만큼 대기한 뒤 재시도한다.
  `scripts/ddobak_api.py`는 이 동작을 이미 구현하고 있다(최대 3회).

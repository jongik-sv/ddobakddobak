---
name: ddobak-meetings
description: >-
  또박또박(ddobak) 회의 API로 회의 내용을 조회·검색·요약한다. 사용자가 "지난 회의 내용
  찾아줘", "그 회의에서 뭐라고 했지", "회의록 요약해줘", "이 회의 노트에 남겨줘"처럼
  회의 이력·전사·요약을 조회하거나 갱신해야 할 때, 또는 텍스트 전사를 회의로
  임포트해야 할 때 사용한다.
---

# 또박또박 회의 API

`scripts/ddobak_api.py`(표준 라이브러리만 사용)로 REST API를 호출한다. 전체 계약은
`AGENT.md`를 참고.

## 설정

가장 쉬운 방법: 또박또박 웹앱 **설정 → API 토큰**에서 토큰을 발급하면 화면에
**`.env.ddobak` 다운로드** 버튼이 뜬다. 받은 파일을 스킬 폴더 루트(`SKILL.md`와
같은 위치)에 넣으면 설정 끝이다. Claude Code 기본 설치 경로 예시:

- macOS/Linux: `~/.claude/skills/ddobak-meetings/.env.ddobak`
- Windows: `%USERPROFILE%\.claude\skills\ddobak-meetings\.env.ddobak`

설정 소스 우선순위: **실제 환경변수 > 패키지 루트의 `.env.ddobak` > 현재 작업
디렉토리(cwd)의 `.env.ddobak`.** 환경변수가 있으면 파일 값은 무시된다(기존
환경변수 사용자와 호환). `DDOBAK_API_URL`·`DDOBAK_API_TOKEN`이 어느 경로로도
채워지지 않으면 스크립트가 즉시 오류 메시지와 함께 종료한다.

브라우저가 다운로드하며 선행 점을 제거해 `env.ddobak`(점 없음)으로 저장되는
경우도 각 위치(패키지 루트/cwd)에서 폴백으로 인식한다 — 파일명을 고칠 필요 없다.

파일 대신 환경변수를 직접 써도 된다:

| 항목 | macOS / Linux | Windows (PowerShell) |
|---|---|---|
| URL | `export DDOBAK_API_URL="https://10.110.2.175"` | `$env:DDOBAK_API_URL="https://10.110.2.175"` |
| 토큰 | `export DDOBAK_API_TOKEN="ddbk_xxxxxxxxxxxx"` | `$env:DDOBAK_API_TOKEN="ddbk_xxxxxxxxxxxx"` |

사설 인증서 환경(자체 서명 HTTPS)에서 TLS 오류가 나면 `DDOBAK_API_INSECURE=1`을
추가로 설정한다(검증 생략, `.env.ddobak` 파일에서는 해당 줄의 `#`을 지운다).

토큰이 담긴 `.env.ddobak`은 비밀 파일이다 — 공유·커밋 금지. POSIX 환경에서는
`chmod 600 .env.ddobak`을 권장한다.

## 첫 호출로 토큰 확인

작업을 시작하기 전에 토큰이 유효한지, 어떤 스코프를 가졌는지 확인한다.

```bash
python3 scripts/ddobak_api.py me
```

Windows에서 `python3`이 없으면 `python` 또는 `py`로 대신 실행한다(이하 모든
`python3 scripts/ddobak_api.py ...` 예시 동일).

## 서브커맨드

| 명령 | 설명 |
|---|---|
| `me` | 토큰·사용자·스코프·만료 확인 |
| `projects` | 프로젝트 목록 |
| `folders <project_id>` | 폴더 트리 |
| `meetings [--project N] [--folder N] [--from D] [--to D] [--status S] [--page N] [--per-page N]` | 회의 목록 |
| `meeting <id>` | 회의 상세 |
| `transcript <id>` | 전사 전체 — `[mm:ss] 화자: 내용` 형식으로 출력 |
| `summary <id>` | 최종 요약(핵심 요약/결정 사항/상세) |
| `search <q> [--project N] [--limit N]` | 하이브리드 검색(발췌 + 회의 참조) |
| `create --title T --project N [--folder N] [--transcript-file F]` | 텍스트 전사로 회의 생성(F는 JSON 파일). 생략 시 빈 배열 — 오디오 업로드용 회의 생성(아래 워크플로 참고) |
| `note <id> [--content C]` | `--content` 없으면 노트 조회, 있으면 추가 |
| `summarize <id>` | 요약 재생성 트리거 |
| `upload-audio <id> <file>` | 오디오 업로드 → STT 큐 |
| `dump <id> [--out DIR]` | 회의 상세+전사+요약을 마크다운 한 파일로 저장 |

모든 서브커맨드에 `--json`을 붙이면 가공하지 않은 원본 JSON을 그대로 출력한다.
스크립트에서 필드를 파싱해 다음 호출에 넘겨야 할 때 사용한다.

## 전형적 워크플로

**"지난 회의에서 X에 대해 뭐라고 했는지 찾아줘"**

```bash
python3 scripts/ddobak_api.py search "X" --json
# 결과(results.transcripts[]/results.summaries[])의 meeting_id 중 가장 관련 있는
# 회의를 골라 전사로 들어가 인용한다.
python3 scripts/ddobak_api.py transcript <meeting_id>
```

검색 결과의 발췌(snippet)만으로 답할 수 있으면 전사 전체를 조회하지 않는다.
발췌가 문맥을 충분히 담지 못할 때만 `transcript`로 들어가 앞뒤 발언을 확인한다.

**"이 회의 요약해줘"**

```bash
python3 scripts/ddobak_api.py summary <meeting_id>
# 아직 요약이 없거나 최신화가 필요하면:
python3 scripts/ddobak_api.py summarize <meeting_id>
```

**"회의 내용 정리해서 로컬에 저장해줘"**

```bash
python3 scripts/ddobak_api.py dump <meeting_id> --out ./notes
```

**회의에 메모 남기기**

```bash
python3 scripts/ddobak_api.py note <meeting_id> --content "다음 회의 전까지 확인할 것: ..."
```

**오디오 파일을 회의로 올리기**

이 API에 오디오를 직접 올리는 단일 엔드포인트는 없다 — `create`로 빈 회의를
먼저 만들고 그 회의에 오디오를 붙이는 두 단계가 유일한 경로다(`--transcript-file`을
생략하면 빈 배열이 자동 전송된다).

```bash
python3 scripts/ddobak_api.py create --title "주간 스탠드업" --project 12 --json
# 응답의 meeting.id를 받아 오디오를 붙인다.
python3 scripts/ddobak_api.py upload-audio <meeting_id> ./recording.m4a
```

이미 전사가 있거나 녹음·전사 진행 중인 회의에 오디오를 올리면 `422`(재시도 불가)로
거부된다 — 코드·세부 조건은 `AGENT.md`의 "오디오 업로드 워크플로" 참고.

## 페이지네이션

`meetings`는 응답에 `meta`(page/total_pages 등)를 포함한다. 다음 페이지가 있으면
사람이 읽는 출력 모드에서 stderr에 안내 줄을 찍는다. 회의가 많은 프로젝트를 훑을
때는 `--per-page`를 키우기보다 `--from`/`--to`로 기간을 좁히는 편이 API 부하와
컨텍스트 소비 모두에 유리하다.

## 429(rate limit) 대응

스크립트 자체가 429를 받으면 `Retry-After` 헤더(초 단위, 기본 2초)만큼 대기 후
최대 3회 자동 재시도한다. 그래도 실패하면 오류 메시지를 stderr로 출력하고
exit code 1로 종료하므로, 반복 호출이 필요한 배치 작업에서는 호출 사이에
약간의 간격을 두는 편이 안전하다.

## 오류

서버 오류(`{error:{code,message}}`)는 `오류: <message>`로 stderr에 출력되고
exit code 1로 끝난다. 401/403이면 토큰 재발급이나 스코프 확인이 필요하고,
404면 대상 프로젝트·회의·폴더 ID를 다시 확인해야 한다.

**422는 재시도로 낫지 않는다.** 요청 내용 자체가 잘못됐다는 뜻이므로, 대기 후
재시도하지 말고 파라미터·바디를 고쳐서 다시 보내야 한다(예: `query_required`·
`invalid_title`·`invalid_folder`·`invalid_transcripts`·`file_required`·
`invalid_state`·`not_started`). 코드별 의미는 `AGENT.md`의 오류 코드 표를 참고.

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

두 환경변수가 필요하다. 없으면 스크립트가 즉시 오류 메시지와 함께 종료한다.

```bash
export DDOBAK_API_URL="https://10.110.2.175"       # 또박또박 서버 주소
export DDOBAK_API_TOKEN="ddbk_xxxxxxxxxxxx"         # 설정 → API 토큰에서 발급
```

사설 인증서 환경(자체 서명 HTTPS)에서 TLS 오류가 나면 `DDOBAK_API_INSECURE=1`을
추가로 설정한다(검증 생략).

## 첫 호출로 토큰 확인

작업을 시작하기 전에 토큰이 유효한지, 어떤 스코프를 가졌는지 확인한다.

```bash
python3 scripts/ddobak_api.py me
```

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
| `create --title T --project N [--folder N] --transcript-file F` | 텍스트 전사로 회의 생성(F는 JSON 파일) |
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

# 또박또박 회의 API 스킬 패키지

또박또박에 저장된 회의 내용을 LLM 에이전트(Claude Code, 기타 도구 호출 에이전트)가
조회·검색·요약·기록할 수 있게 해주는 패키지입니다.

## 1. API 토큰 발급

또박또박 웹앱에서 **설정 → API 토큰**으로 이동해 새 토큰을 발급받으세요. 토큰은
`ddbk_...` 형식이며, 발급 시 한 번만 전체 값이 표시되므로 안전한 곳에 보관하세요.

## 2. 환경변수 설정

```bash
export DDOBAK_API_URL="https://<또박또박-서버-주소>"
export DDOBAK_API_TOKEN="ddbk_xxxxxxxxxxxx"
```

셸 프로필(`~/.zshrc`, `~/.bashrc` 등)에 추가하면 매번 다시 설정할 필요가 없습니다.
사설 인증서를 쓰는 서버라 TLS 오류가 난다면 `DDOBAK_API_INSECURE=1`도 함께
설정하세요.

## 3. Claude Code 스킬로 설치

이 폴더 전체를 `~/.claude/skills/ddobak-meetings/`에 복사하면 Claude Code가
자동으로 이 스킬을 인식합니다.

```bash
cp -r ext_skill ~/.claude/skills/ddobak-meetings
```

이후 "지난 회의에서 예산 얘기 나온 거 찾아줘"처럼 회의 관련 요청을 하면
Claude Code가 알아서 이 스킬을 사용합니다.

## 4. 다른 LLM 에이전트에서 활용

Claude Code가 아닌 다른 에이전트(ChatGPT의 커스텀 GPT, 범용 도구 호출 에이전트,
자체 구축한 에이전트 등)를 쓴다면:

- `AGENT.md`를 에이전트의 시스템 프롬프트나 컨텍스트에 포함해 REST 계약을
  알려주세요.
- 도구 호출을 지원하는 에이전트라면 `scripts/ddobak_api.py`를 셸 명령 실행
  도구로 호출하게 하세요(파이썬 표준 라이브러리만 사용하므로 별도 패키지
  설치가 필요 없습니다).
- 셸 실행이 불가능한 환경이라면 `AGENT.md`의 curl 예시를 참고해 에이전트가
  직접 HTTP 요청을 만들도록 안내하세요.

## 5. 사람이 직접 사용하기

CLI를 터미널에서 바로 써도 됩니다.

```bash
python3 scripts/ddobak_api.py meetings --project 12 --from 2026-08-01
python3 scripts/ddobak_api.py search "예산"
python3 scripts/ddobak_api.py dump 456 --out ./notes
```

## 파일 구성

| 파일 | 용도 |
|---|---|
| `SKILL.md` | Claude Code 스킬 정의(트리거 조건 + 사용법) |
| `AGENT.md` | 벤더 중립 API 레퍼런스(REST 계약 + curl/CLI 예시) |
| `scripts/ddobak_api.py` | 표준 라이브러리만 사용하는 CLI |
| `README.md` | 이 문서 |

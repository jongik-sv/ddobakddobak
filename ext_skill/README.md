# 또박또박 회의 API 스킬 패키지

또박또박에 저장된 회의 내용을 LLM 에이전트(Claude Code, 기타 도구 호출 에이전트)가
조회·검색·요약·기록할 수 있게 해주는 패키지입니다.

## 1. API 토큰 발급

또박또박 웹앱에서 **설정 → API 토큰**으로 이동해 새 토큰을 발급받으세요. 토큰은
`ddbk_...` 형식이며, 발급 시 한 번만 전체 값이 표시되므로 안전한 곳에 보관하세요.

## 2. 설정 파일(.env.ddobak) 준비

가장 쉬운 방법: 토큰 발급 화면에 뜨는 **`.env.ddobak` 다운로드** 버튼을 눌러
파일을 받으세요. 이 파일에는 서버 주소와 토큰이 이미 채워져 있습니다.

파일을 직접 받지 못했다면(예: 발급자와 사용자가 다른 경우) 아래 템플릿을
`.env.ddobak`이라는 이름으로 스킬 폴더 루트(`SKILL.md`와 같은 위치)에 만드세요.

```
DDOBAK_API_URL=https://<또박또박-서버-주소>
DDOBAK_API_TOKEN=ddbk_xxxxxxxxxxxx
# DDOBAK_API_INSECURE=1   ← 자체 서명 인증서(사설 HTTPS)일 때만 주석 해제
```

`.env.ddobak`은 토큰이 담긴 비밀 파일입니다 — 공유·커밋 금지. POSIX 환경에서는
`chmod 600 .env.ddobak`을 권장합니다.

파일 대신 환경변수를 써도 됩니다(설정돼 있으면 파일보다 우선합니다):

| 항목 | macOS / Linux | Windows (PowerShell) |
|---|---|---|
| URL | `export DDOBAK_API_URL="https://<주소>"` | `$env:DDOBAK_API_URL="https://<주소>"` |
| 토큰 | `export DDOBAK_API_TOKEN="ddbk_xxxxxxxxxxxx"` | `$env:DDOBAK_API_TOKEN="ddbk_xxxxxxxxxxxx"` |

셸 프로필(`~/.zshrc`, `~/.bashrc`, PowerShell `$PROFILE`)에 추가하면 매번 다시
설정할 필요가 없지만, `.env.ddobak` 파일을 쓰는 편이 더 간단합니다.

## 3. Claude Code 스킬로 설치

이 폴더 전체(다운로드한 `.env.ddobak` 포함)를 스킬 디렉토리에 복사하면 Claude
Code가 자동으로 이 스킬을 인식합니다.

macOS / Linux:

```bash
cp -r ext_skill ~/.claude/skills/ddobak-meetings
```

Windows (PowerShell):

```powershell
Copy-Item -Recurse ext_skill "$env:USERPROFILE\.claude\skills\ddobak-meetings"
```

압축 파일(zip)로 받았다면 먼저 풀어야 합니다.

macOS / Linux:

```bash
unzip ddobak-skill.zip -d ddobak-meetings
cp -r ddobak-meetings ~/.claude/skills/ddobak-meetings
```

Windows (PowerShell):

```powershell
Expand-Archive ddobak-skill.zip -DestinationPath ddobak-meetings
Copy-Item -Recurse ddobak-meetings "$env:USERPROFILE\.claude\skills\ddobak-meetings"
```

설치 후 최종 경로는 다음과 같아야 합니다(`.env.ddobak`을 나중에 채워 넣었다면
이 경로에 두세요):

- macOS/Linux: `~/.claude/skills/ddobak-meetings/.env.ddobak`
- Windows: `%USERPROFILE%\.claude\skills\ddobak-meetings\.env.ddobak`

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

macOS / Linux:

```bash
python3 scripts/ddobak_api.py meetings --project 12 --from 2026-08-01
python3 scripts/ddobak_api.py search "예산"
python3 scripts/ddobak_api.py dump 456 --out ./notes
```

Windows (PowerShell — `python3`이 없으면 `python` 또는 `py`):

```powershell
python scripts\ddobak_api.py meetings --project 12 --from 2026-08-01
python scripts\ddobak_api.py search "예산"
python scripts\ddobak_api.py dump 456 --out .\notes
```

## 파일 구성

| 파일 | 용도 |
|---|---|
| `SKILL.md` | Claude Code 스킬 정의(트리거 조건 + 사용법) |
| `AGENT.md` | 벤더 중립 API 레퍼런스(REST 계약 + curl/CLI 예시) |
| `scripts/ddobak_api.py` | 표준 라이브러리만 사용하는 CLI |
| `README.md` | 이 문서 |

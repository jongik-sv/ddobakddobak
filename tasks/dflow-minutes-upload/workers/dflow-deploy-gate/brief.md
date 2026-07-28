# brief — D'Flow 배포 관문·스모크 환경 실동작 조사 (팀장 결정 항목 2 근거)

target_repo: /Users/jji/project/ddobakddobak
write_scope: `tasks/dflow-minutes-upload/artifacts/dflow-deploy-gate-2026-07-28.md` (신규 1개만)
output_format: 질문별 실동작 + 근거(`file#symbol`) + 우리 항목 2에 대한 판정

## ⚠️ D'Flow 레포는 읽기 전용

`/Users/jji/project/wbs-web`. **파일 수정·git 조작(checkout·pull·branch·stash·commit) 전면 금지.**
읽기는 `git show <ref>:<path>` 로만. ref 두 개:
- `origin/main` (HEAD `f3d1aef`) — 신규 ops 커밋 6개가 여기 있다
- `origin/feat/minutes-folder-path` (HEAD `7823391`) — folder_path 작업 브랜치

```
git -C /Users/jji/project/wbs-web show origin/main:scripts/smoke-prod.mjs
git -C /Users/jji/project/wbs-web show origin/feat/minutes-folder-path:docs/design/folder-path-progress.md
```

## 배경

우리 팀장 결정 문서(`tasks/dflow-minutes-upload/artifacts/team-lead-open-decisions-2026-07-28.md`) 항목 2가
**"R1~R3 배포 일정 — 실질 질문은 런타임 스모크 환경(전용 테스트 Supabase) 확보 여부, 현재 0건"** 이다.

방금 D'Flow `origin/main`에 배포 관문·롤백 런북·마이그레이션 원장이 들어왔다:
`72cf17a` push 전·배포 후 2단 관문 + 롤백 런북 · `d051949` 마이그레이션 적용 원장 ·
`c0b41b7` 적대적 검토 30건 · `f1b189a`·`f3d1aef` pre-push 수정.

**이게 "스모크 0건"을 뒤집는지 판정하는 게 이 작업의 전부다.**

## 답할 질문 (순서대로, 각각 근거 필수)

### Q1. `scripts/smoke-prod.mjs` — 대상 환경이 어디인가
- base URL·프로젝트를 **하드코딩**하나, **환경변수**로 받나? 변수명은?
- 운영(production) 전용인가, 별도 테스트 Supabase를 가리킬 수 있나?
- ⚠️ **배포 후 운영 스모크는 "전용 테스트 Supabase"가 아니다.** 둘을 구분해 판정하라.

### Q2. 스모크가 `/minutes`·폴더 API를 건드리나 — **이 답이 항목 2의 권고를 뒤집는다**
- 스모크가 검사하는 엔드포인트·화면 목록을 전부 뽑아라
- `POST /minutes`, `POST /minutes/folder`, `folder_path`, `include_archived` 중 하나라도 커버하나?
- **커버 안 하면 "관문은 생겼지만 우리 연동은 미커버 → 우리 기준 0건 유지"** 로 판정.

### Q3. `.githooks/pre-push` — 관문 G1·G2가 무엇을 막나
- 정확히 무슨 조건에서 push를 거부하나
- 우리(또박또박)가 영향받는 게 있나 (없으면 "없음"이라고 쓸 것)

### Q4. `docs/runbook-rollback.md` + `CLAUDE.md`(origin/main 신규) — 배포 순서·승인자
- **릴리스 차수(R1·R2·R3·R4)나 플래그 전환 절차가 명시돼 있나?**
- 배포 승인자·실행자가 지정돼 있나? ("누가 받아올지"의 답 후보)
- `supabase/migrations/0050_migration_ledger.sql` 원장이 롤백 가능 판정에 쓰이는 방식 한 줄

### Q5. 플래그 사다리 — `docs/design/folder-path-progress.md` (folder-path 브랜치)
- `MINUTES_FOLDER_PATH_ENABLED` · `MINUTES_FOLDER_DND_ENABLED`(커밋 `274e8c6`, R4 D&D) 두 플래그의 **전환 순서·조건**
- **R1·R2·R3·R4 각각의 착수 조건 / 날짜가 문서에 있나?** 날짜가 없으면 "날짜 없음 — 조건만 있음"이라고 명시
- 같은 브랜치 `docs/design/folder-path-backlog.md`에 배포·스모크 관련 미결이 있으면 함께

## 출력

`tasks/dflow-minutes-upload/artifacts/dflow-deploy-gate-2026-07-28.md` **1개만**.
- 맨 위 **3줄 결론**: ① 스모크 환경 확보됐나(예/아니오/부분) ② 우리 연동 커버되나 ③ R1 날짜 답이 소스에 있나
- Q1~Q5 각각 `실동작 | 근거 | 우리 영향`
- 마지막에 **`⚠️ 소스로 확정 못 한 것`** — 여기에만 사람에게 물을 것을 남긴다

## 규칙

- 인용은 **`file#symbol`** 또는 `§조항번호`. **행 번호를 문서에 옮겨 적지 말 것** (이 리포에서 행 번호가 하루 세 번 밀렸다)
- 소스에 없으면 **`소스에 없음`** 이라고 쓸 것. 추측 금지
- 소스는 계약이 아니다 — "현재 구현 실측" 톤 유지

## Do NOT

- `/Users/jji/project/wbs-web` 수정·git 조작
- git 커밋·푸시·`git add` (양쪽 레포 모두)
- 네트워크 요청(운영 API 호출) — 이 작업은 소스 읽기만
- 또박또박 코드 수정

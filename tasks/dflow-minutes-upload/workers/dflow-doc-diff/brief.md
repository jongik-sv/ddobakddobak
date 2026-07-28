# brief — D'Flow 문서 사본 대조 (팀장 「나중 4건」이 이미 결정됐는지 판정)

target_repo: /Users/jji/project/ddobakddobak
write_scope: `tasks/dflow-minutes-upload/artifacts/dflow-doc-diff-2026-07-28.md` (신규 1개만)
output_format: 항목별 `우리 사본 | D'Flow 사본 | 결정됐나 | 근거`

## ⚠️ D'Flow 레포는 읽기 전용

`/Users/jji/project/wbs-web`. **파일 수정·git 조작(checkout·pull·branch·stash·commit) 전면 금지.**
읽기는 `git show origin/feat/minutes-folder-path:<path>` 로만. 비교가 필요하면
`$CLAUDE_JOB_DIR/tmp/` 로 뽑아서 diff 하라 (`/tmp` 금지 — 병렬 잡이 서로 덮어쓴다).

## 배경

D'Flow 브랜치에 **우리가 포크한 문서들의 D'Flow 원본**이 있다. 우리 사본은 2026-07-27 시점이고,
D'Flow 사본에는 **그 뒤에 내려진 결정**이 들어 있을 수 있다. 사용자 질문이 정확히
**"팀장 결정이 어떻게 결정되었는지 확인해서 리스트를 만들어라"** 다.

| D'Flow (`origin/feat/minutes-folder-path`) | 우리 사본 (`tasks/dflow-minutes-upload/artifacts/`) |
|---|---|
| `docs/design/dflow-decisions-final-2026-07-27.md` | `decisions-final-2026-07-27.md` |
| `docs/design/dflow-folder-path-worklist-2026-07-27.md` | `ddobak-folder-path-worklist-2026-07-27.md` |
| `docs/design/folder-path-handoff-2026-07-27.md` | `handoff-2026-07-27.md` |
| `docs/design/folder-path-backlog.md` | **대응 사본 없음 — 전문 정독** |
| `docs/design/ddobak-notice-2026-07-28.md` | 없음(D'Flow가 우리 앞으로 쓴 통지문) |

## 할 일

### 1. 대조 대상 4건의 답을 찾아라 (우리 문서 「나중에 필요한 것」 표)

각각 **결정됨 / 미결 / 소스에 없음** 중 하나로 판정하고 근거를 붙여라.

1. **R2 시점 확정** — 플래그 전환(false→true) 착수 조건이 문서에 있나
2. **배치 실행 권한 — PMO 명의 사용 승인** — `pmo_admin` 게이트를 누구 계정으로 통과하는지, 위임·명의 사용에 대한 D'Flow 측 서술이 있나
3. **재편철 대조표 정리 판정 소유자** — APPLY 전 "D'Flow 위치가 오답인지" 판정을 누가 하기로 했나
4. **claim 오매칭 정책 / T4 게이트** — 자동 링크 claim 이 잘못 붙었을 때 정책, T4 착수 게이트 조건. `folder-path-backlog.md` 가 1순위 후보다

### 2. `ddobak-notice-2026-07-28.md` — 우리 회신문 항목 2·4·6과의 관계

우리 회신문 `tasks/dflow-minutes-upload/artifacts/ddobak-reply-2026-07-27.md` 의 **요청 2·4·6번**이
stale 이다(2·6은 취소된 수작업 약속, 4는 우리가 직접 답을 계산했다).
- D'Flow 통지문이 **그 3건 중 무엇에 이미 답했거나 무효화했나?**
- 통지문의 **송부 상태** 기재를 그대로 인용하라
- 통지문이 **우리에게 요구하는 것** 목록을 뽑아라 (회신문 정정판에 반영해야 한다)

### 3. 우리 사본 대비 실질 델타

3개 대조쌍에서 **내용이 달라진 조항**만 뽑아라. 서식·오탈자 차이는 버린다.
"우리 사본이 모르는 결정"만 골라내는 게 목적이다.

## 출력

`tasks/dflow-minutes-upload/artifacts/dflow-doc-diff-2026-07-28.md` **1개만**.
- 맨 위 **3줄 결론**: 4건 중 몇 건이 소스로 답이 나왔나 / 회신문 정정 필요 항목 / 우리가 몰랐던 결정 개수
- 4건 판정 표: `# | 항목 | 판정 | 답(있으면) | 근거(§조항 or file#symbol)`
- 통지문 요구사항 목록
- 실질 델타 표
- 마지막 **`⚠️ 소스로 확정 못 한 것 — 사람에게 물어야 하는 것`**

## 규칙

- 인용은 **`file#symbol`** 또는 `§조항번호`. **행 번호를 옮겨 적지 말 것**
- 소스에 없으면 **`소스에 없음`**. 추측으로 채우지 말 것
- 임시 파일은 `$CLAUDE_JOB_DIR/tmp/` 에만

## Do NOT

- `/Users/jji/project/wbs-web` 수정·git 조작
- git 커밋·푸시·`git add` (양쪽 레포 모두)
- 우리 사본 덮어쓰기 — **델타 문서만** 만든다
- `team-lead-open-decisions-2026-07-28.md` 수정 (오케스트레이터가 한다)
- 네트워크 요청

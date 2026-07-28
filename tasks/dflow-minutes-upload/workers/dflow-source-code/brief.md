# brief — D'Flow 소스 실동작 조사 (ddobak-W8·W12·W13 차단 해제 판정)

target_repo: /Users/jji/project/ddobakddobak
write_scope: `tasks/dflow-minutes-upload/artifacts/dflow-source-findings-2026-07-28.md` (신규 1개만)
output_format: 항목별 실동작 + 근거 심볼 + 또박또박 영향 + 미확정 목록
근거: `handoff-2026-07-27.md` §5(막힌 것과 이유) · `decisions-final-2026-07-27.md` §2-C·§2-J

## ⚠️ D'Flow 소스는 읽기 전용

`/Users/jji/project/wbs-web` = D'Flow 레포. **어떤 파일도 수정하지 말 것. git 조작(checkout·pull·branch·stash) 금지.**
읽기는 `git show <ref>:<path>` 로만 — 워킹 트리를 건드리지 않는다. 대상 ref: **`origin/feat/minutes-folder-path`**

```
git -C /Users/jji/project/wbs-web show origin/feat/minutes-folder-path:src/lib/minutes/folders.ts
git -C /Users/jji/project/wbs-web ls-tree -r --name-only origin/feat/minutes-folder-path src/
git -C /Users/jji/project/wbs-web log --oneline origin/main..origin/feat/minutes-folder-path
```

관련 커밋: `afc1943` = `feat(minutes-api): 일괄 재편철 배치 엔드포인트 POST /minutes/folder (W6)`

## 배경

우리는 아래 3건이 "계약 v2.4 미수령"으로 막혔다고 판단해 왔다. **소스를 직접 볼 수 있게 됐으니 실동작으로 판정한다.**

| 우리 항목 | 막힌 이유(기존 판단) |
|---|---|
| `ddobak-W8` 배지 | `folder_path_status` 키 이름·위치(등록 응답 / 배치 `results[]`)·null 의미를 모른다 |
| `ddobak-W12`·`W13` 재편철 | 배치 엔드포인트 계약이 우리 사본에 없다 |

## 조사할 것 — 소스에서 **실제로 무엇을 하는가**

### 1. 업로드 경로 (`POST /minutes`)
- `folder_path`를 어떻게 파싱·정규화하는가 (root-first? 팀코드 판정? 한 칸 내림?)
- **응답에 무엇을 싣는가** — `folder_id`·`folder_path`가 실리는가, 키가 빠지는 조건이 있는가
- **`folder_path_status`가 존재하는가?** 없으면 "없다"고 명확히. 있으면 키 이름·위치·가능한 값·각 값의 의미
- 폴더명 길이·정규화(NFC?)·중복 처리, 깊이 한도와 **절단 동작**(무통보 절단인가)

### 2. 배치 재편철 (`POST /minutes/folder`, `afc1943`)
- 라우트 파일 경로와 핸들러 심볼
- 요청 스키마: 필드명·타입·필수 여부·`items[]` 구조·`from`/`to` 의미와 nullable 여부
- 응답 스키마: `results[]` 각 항목의 키·상태값 enum·부분 실패 표현
- 권한: `pmo_admin` 게이트가 있는가, 없으면 무엇으로 인가하는가
- dry-run 지원 여부
- 에러: 타입 오류가 **요청 전체 400**인가 **건별 실패**인가 (정본 §2-E ⑥이 "현재 구현이 전체 400이라 계약과 어긋난다"고 적었다 — 소스로 확인하라)

### 3. 조상 규칙(§2-J) · 연결 초기화(`dflow-W10`)
- 재편철 판정에 조상 규칙이 구현돼 있는가
- 연결 초기화가 무엇을 지우는가(`external_id`? 링크만?) — `ddobak-W15`·`W16`의 §7.7 대상 2 판정에 필요

### 4. 플래그
- `MINUTES_FOLDER_PATH_ENABLED`(또는 동등물)가 소스에 있는가, 기본값은, 무엇을 껐다 켜는가

## 출력

`tasks/dflow-minutes-upload/artifacts/dflow-source-findings-2026-07-28.md` **1개만** 생성.
- 맨 위 3줄 요약: **W8·W12·W13이 지금 착수 가능한가**(각각 가능/불가 + 이유 한 줄)
- 항목별로 `실동작 | 근거(file#symbol) | 또박또박 영향 | 계약 문서와 어긋나는 점`
- 마지막에 **`⚠️ 소스로도 확정 못 한 것`** 목록 — 여기에만 "D'Flow에 물어야 할 것"을 남긴다
- 인용은 **`file#symbol`**. **행 번호 금지**

## ⚠️ 소스는 계약이 아니다

소스는 **현재 브랜치의 구현**이지 확정 계약이 아니다. R1 배포 전에 바뀔 수 있다.
→ 발견을 "계약 확정"으로 쓰지 말고, **"현재 구현 실측 — 계약 문서화는 v2.4 대기"** 톤을 유지할 것. 우리가 이걸 근거로 코딩하면 **드리프트 위험이 있다는 점도 문서에 명시**하라.

## Do NOT

- `/Users/jji/project/wbs-web` 수정·git 조작 (읽기는 `git show`로만)
- 또박또박 코드 구현 착수 (판정만 한다)
- git 커밋·푸시·`git add`
- 추측으로 채우기 — 소스에 없으면 `소스에 없음`이라고 쓸 것

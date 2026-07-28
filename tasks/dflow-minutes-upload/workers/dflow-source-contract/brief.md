# brief — D'Flow 계약 v2.3 정독 + 우리 사본(v2.1) 델타 (ddobak-W18 선행)

target_repo: /Users/jji/project/ddobakddobak
write_scope: `tasks/dflow-minutes-upload/artifacts/dflow-contract-v23-delta-2026-07-28.md` (신규 1개만)
output_format: 델타 표 + 미해결 목록 + 검증 방법
근거: `decisions-final-2026-07-27.md` §2-E(v2.4 반영 9건) · `handoff-2026-07-27.md` §5(막힌 이유)

## ⚠️ D'Flow 소스는 읽기 전용

`/Users/jji/project/wbs-web` = D'Flow 레포(GitHub `donseok/wbs-web`). **어떤 파일도 수정하지 말 것. git 조작(checkout·pull·branch·stash) 금지.**
읽을 때는 `git show <ref>:<path>` 로만 접근한다 — 워킹 트리를 건드리지 않는다. 브랜치는 이미 fetch돼 있다:

```
git -C /Users/jji/project/wbs-web show origin/feat/minutes-folder-path:docs/design/dflow-minutes-upload-api-spec.md
```

## 배경 — 왜 이 작업이 생겼나

우리는 "계약 v2.4를 못 받아서 W8·W12·W13·W18이 막혔다"고 판단해 왔다. 그런데 **D'Flow 소스를 직접 볼 수 있다**는 사실이 확인됐다.
- `4387576` = 계약 **v2.3** (`docs(api-spec): 회의록 업로드 API 계약 v2.3 — folder_path·배치·연결 초기화 (W8)`)
- 우리 사본 `tasks/dflow-minutes-upload/artifacts/dflow-minutes-upload-api-spec.md` = **v2.1** (`folder_path` 0건, 배치 엔드포인트 0건)
- v2.4는 **아직 존재하지 않는다** — v2.3 위에 9건을 더 반영해 한 번에 송부하기로 한 것(정본 §2-E)

## 할 일

### 1. v2.3 전문을 읽고 v2.1(우리 사본)과의 **델타**를 만든다

`folder_path` 관련 전 조항(§3·§4.2·§4.3·§4.7·§4b·§4c·§5·§8·§9)을 빠짐없이. 특히:
- `folder_path` 요청 필드 — 타입·순서(root-first인지)·3값 규약(키 부재 / `[]` / 배열)의 **계약상 정의**
- 응답에 실리는 편철 결과 — `folder_id`·`folder_path` 키가 **언제 실리고 언제 빠지는지**
- 폴더명 제약(길이·정규화·중복), 깊이 한도와 **절단 규칙**
- 배치 재편철 엔드포인트 — 경로·요청 스키마·응답 `results[]` 구조·부분 실패 처리·권한
- 연결 초기화(`dflow-W10`) 조항

### 2. 정본 §2-E의 **v2.4 반영 9건**을 v2.3과 대조

9건 각각에 대해 **이미 v2.3에 들어있는지 / 아직 없는지**를 판정하고 근거(계약 조항 인용)를 붙여라. 정본 §2-E 표를 그대로 축으로 쓸 것.

### 3. 결론 — 무엇이 실제로 남았나

"v2.4 미수령"이라는 차단 사유가 **어디까지 해소되고 무엇이 진짜로 남는지** 한 문단으로. `ddobak-W18`(사본 동기화)을 지금 할 수 있는지도 판정.

## 출력

`tasks/dflow-minutes-upload/artifacts/dflow-contract-v23-delta-2026-07-28.md` **1개만** 생성.
- 맨 위 3줄 요약(무엇이 풀렸나 / 무엇이 남았나 / 다음 행동)
- 델타 표: `항목 | v2.1(우리 사본) | v2.3(D'Flow) | 또박또박 영향 | 관련 W번호`
- v2.4 9건 대조 표: `# | 항목 | v2.3에 있나 | 근거`
- 코드·계약 인용은 **`file#symbol` 또는 `§조항번호`**. **행 번호를 옮겨 적지 말 것**(이 리포에서 행 번호가 하루 세 번 밀렸다)

## Do NOT

- `/Users/jji/project/wbs-web` 수정·git 조작 (읽기는 `git show`로만)
- 우리 쪽 사본(`dflow-minutes-upload-api-spec.md`) 덮어쓰기 — **이번엔 델타 문서만** 만든다
- 코드 구현 착수 (W12·W13은 별도)
- git 커밋·푸시·`git add`
- 추측으로 채우기 — 계약에 없으면 `계약에 없음`이라고 쓸 것

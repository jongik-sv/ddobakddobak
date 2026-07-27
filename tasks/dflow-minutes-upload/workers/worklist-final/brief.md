# brief — 워크리스트에 결정 정본 ＋ 실서버 실측 반영

target_repo: /Users/jji/project/ddobakddobak
write_scope: `tasks/dflow-minutes-upload/artifacts/ddobak-folder-path-worklist-2026-07-27.md` **단 하나**
output_format: 절별 변경 요약 · 반영 전/후 행수 · 미반영 항목이 있으면 사유
근거(읽을 것): `artifacts/decisions-final-2026-07-27.md` (**결정 정본**) · `artifacts/prod-survey-2026-07-27.md` (**실서버 실측**)

## 대전제

정본이 **또박또박 권고안의 전제 3개를 뒤집었다.** `decisions-proposed-2026-07-27.md`를 근거로 삼지 말 것.
① D'Flow는 착수 완료(브랜치에 W1~W6·W24 구현됨) → "W6 먼저"는 **기각**, 서버 플래그 `MINUTES_FOLDER_PATH_ENABLED`로 대체
② 기존 전송분은 평평하지 않다 — **19건 중 17건이 이미 하위 폴더**(사람이 정리)
③ 폴더 소유권 심각도 하향(41명 중 28명 `pmo_admin`)

## 1. ⚠️ 미결 4건 전부 해제 — "팀장 판단" 문구를 결정문으로 교체

| 절 | 확정 |
|---|---|
| §3.3 미분류 응답값 | **`folder_id: null` ＋ `folder_path: null`** 확정. `[]`(팀 루트 편철 **성공**)와 구분. ＋ 배치 응답 **`from`도 `string[] \| null`**(null = 이동 전 미분류) |
| §7.3 `manual_placement` 판정 | **조상 규칙**(정본 §2-J)으로 확정. 판정축이 "팀 루트냐"가 아니라 **"현재 위치가 목표 경로의 조상이냐"**. 동일→`already_correct`(최우선) / 미분류→이동 / **조상→이동** / 형제·자손·무관→`skipped(manual_placement)`. **또박또박 코드 변경 0**, dry-run 해석만 달라진다 |
| §7.6 archived 오진 | **(a) 확정** — D'Flow가 `include_archived` 파라미터 ＋ 응답 `items[].archived` 노출(`dflow-W24`, **R1에 포함**). 문구를 **초기화 / 보관 / 삭제 3분**으로. 보관이면 복구는 "D'Flow에서 보관 해제"뿐(재전송은 409) |
| §6 깊이 절단 | **절단 유지 확정**(400 전환 안 함). 단 "D'Flow 변경 0"은 기각 — **`folder_path_status: "exact"\|"truncated"\|"partial"\|"unclassified"`** 를 등록 응답·배치 `results[]`에 신설. `ddobak-W4`·`W7` 사전 경고(차단 아님)는 유지하되 **`teamOverride` 확정 후 재평가**, ⚠️ **팀 목록 하드코딩 금지 — `GET /minutes/meta`의 `teams` 사용**(런타임 마스터라 6번째 팀이 등록되면 어긋난다) |

## 2. §5 배포표를 **정본 §3 순서로 교체**

플래그 개념(R1 = 코드 배포 + `MINUTES_FOLDER_PATH_ENABLED=false`, R2 = env 전환)을 도입하고, **지켜야 할 제약은 3개뿐**임을 명시:

```
1. dflow-W24 ≤ ddobak-W14 ≤ dflow-W10   (실질: R1 이후, R3 이전)
2. 또박또박 2차는 R2(플래그 true) 이후
3. 재편철 1회차는 R2 이전
```

＋ **1차는 언제 내도 무해**(플래그 false 동안 `folder_path` 완전 무시 — 400도 안 난다).
＋ 기존 "`dflow-W3` 선배포 금지" 류 서술 중 정본과 어긋나는 것 정정 — **진짜 위험은 `dflow-W3`가 아니라 `dflow-W5`다**(재전송 1건마다 위치가 덮이고 `[]`는 팀 루트로 평평화. `overwrite_manual`은 배치 전용이라 이 경로를 못 막는다).

## 3. §7.0에 배치 실행 규약

- **`ACTOR_EMAIL` = `donseok75@gmail.com`** (실명 담당자·`pmo_admin` 확인됨). 전용 서비스 계정 반대
- 배치 라우트에 **`pmo_admin` 게이트** 신설 → role 미달이면 `403 forbidden_role`
- 배치가 만드는 폴더의 `created_by`는 **ACTOR 명의 유지**(일괄 재편철 생성분 감사 표식)

## 4. §7에 재편철 1회차 운영 절차 6단계 (정본 §4)

① 19건 전량 `dry_run: true`·`overwrite_manual: false` **1요청**(상한 200) → ② `from`/`to`/`status` 대조표 D'Flow 회신 → ③ `manual_placement` 건 **PMO가 어느 쪽이 정답인지 판정** → ④ **D'Flow 위치가 정답이면 또박또박에서 폴더를 옮긴다**(D'Flow만 고치면 다음 재전송에 다시 덮인다) → ⑤ **또박또박 위치가 정답인 건만** `items`에 담아 APPLY → ⑥ `to == [팀코드]`인 항목을 평평화 예정으로 사전 공유

경고 3개를 그대로 실을 것:
- ⚠️ **`manual_placement` 건수를 `OVERWRITE_MANUAL`의 근거로 쓰지 말 것** — 조상 규칙 적용 후에도 정상적으로 남는다(사람이 다른 가지로 옮긴 건). 켜면 사람 정리분을 덮는다
- ⚠️ ③~⑤는 **R2 전에** 끝내야 한다(`overwrite_manual`은 재전송 경로를 못 막는다)
- ⚠️ **재전송으로 재편철하지 말 것** — 버전 append·후처리 재실행·목록 전건 "방금 수정됨"
- 2회차는 `items`를 **창 구간 전송분만**(`dflow_synced_at` > 1회차 실행 시각)으로 한정

## 5. ⚠️ §7.7 대상 1 판정 기준 **정정** — 실측이 D0-15를 깨뜨렸다

`D0-15`가 대상 1을 **"`dflow_synced_at` 없음"** 으로 넓혔는데, 실서버에 그 조건에 걸리면서 **이미 D'Flow에 연결된** 회의가 **4건** 있다(`prod-survey` §4). 원인은 `claim` 경로가 `dflow_url`만 갱신하고 `dflow_synced_at`은 안 건드리는 것(`meeting_dflow_controller.rb:100-104`, **정상 동작** — claim은 전송이 아니다).

이대로면 자동 링크가 이 4건을 대상 1로 잡아 **다른 미연결 회의록에 재claim** → 기존 연결이 끊긴 **고아 + 오매칭**이 생긴다.

→ 대상 1 기준을 **"`dflow_synced_at` 없음 **AND** `exists_on_dflow == false`"** 로 정정하라. `public_uid` 유무는 판정 기준이 될 수 없다(claim이 채우므로).

## 6. 실서버 실측 반영 (`prod-survey-2026-07-27.md`)

- **§6 깊이**: 실효 5단 이상 **0건**, 최대 **2**. 사전 경고는 현 시점 발동 0건 → 저비용
- **§7 `[]`**: 연동 18건 중 폴더 미소속 **1건**이고 D'Flow에서도 이미 팀 루트 → **평평화 피해 0**
- **§7.7 / §8**: 19건 예상 판정 = `moved` 1 · `already_correct` 11 · `manual_placement` 6 · **items 제외 1**(또박또박 원본이 삭제된 고아 `019f87db-c94d`)
- **⚠️ `ddobak-W12`·`W13` 요건 추가**: 배치 `items` 생성 시 **또박또박에서 삭제된(soft delete) 회의를 제외**할 것. 목표 경로를 만들 원본이 없다
- **⚠️ 폴더명 불일치 1건**: D'Flow `ERP/영업` vs 또박또박 `ERP/영업팀` — 재편철하면 **중복 폴더가 생긴다**. 이름 통일이 선행돼야 함(§7 주의로 등재)
- **자유 루트 정리 권고**: `ma`·`test` 루트가 있다 — 전송되면 D'Flow에 `<팀>/ma` 폴더가 생긴다. 2차 전 정리

## 7. §4 작업표 갱신

- **`W9`** — 배치 응답 **`from: string[] \| null`** 추가 명시(정본 §2-D)
- **`W8`** — **`folder_path_status` 배지**(`truncated`·`partial`·`unclassified`일 때 눈에 띄게) 추가, 2차
- **`W15`·`W16`** — `GET /minutes?linked=true` 순회에 **`include_archived=true`** ＋ `archived: true` 행은 "존재함(보관)"으로 **차집합에서 제외**. ⚠️ **`linked=false`(후보 조회)에는 절대 켜지 말 것** — 보관분은 claim 대상이 아니다(409). 라우트가 막지 않으므로 **호출 측 규약**
- **`W15`·`W16` 착수 조건**(정본 §6): 자동 링크 v1은 **자동 claim을 끄고 dry-run 리포트 + 사람 승인만**. 되돌리기 수단이 없다. ＋ "후보의 작성자가 또박또박 전송 계정이면 자동 claim 금지"
- **`W18`** — 정본은 **계약 v2.4**다(v2.2/v2.3 아님). D'Flow가 9건을 한 번에 반영해 송부 예정 → **v2.4 도착 대기**로 표기
- **통보 사항**(정본 §6): D'Flow에서 팀을 **비활성화하면 그 팀 회의록의 재전송이 실패**한다(현재 500 → 400 + 명시 사유로 매핑 예정)

## Do NOT

- `ddobak-W14`·`ddobak-W17` **행의 구현 세부 서술 건드리기** — 별도 에이전트가 코드 작업 중이며 완료 후 후속 패스로 반영한다. (§1의 §7.6 **문구 결정** 반영은 하되, W14 행의 파일·위치 서술은 손대지 말 것)
- 다른 파일 수정 — 이 워크리스트 **1개만**
- `dflow-folder-path-worklist-2026-07-27.md` 수정 (D'Flow 확정본)
- 결정 정본·실측 문서 수정 (근거 문서)
- 정본에 없는 내용을 임의로 결론짓기 — 근거가 없으면 그대로 두고 보고에 적을 것
- 커밋·푸시

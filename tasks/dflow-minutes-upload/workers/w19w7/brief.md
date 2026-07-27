# brief — ddobak-W19 → ddobak-W7 (upload 응답 pass-through · 편철 경로 미리보기)

target_repo: /Users/jji/project/ddobakddobak
write_scope: `backend/app/controllers/api/v1/meeting_dflow_controller.rb` · `backend/spec/requests/api/v1/meeting_dflow_spec.rb` · `frontend/src/api/dflow.ts`(필요 시) · `frontend/src/lib/dflowAutoAssign.ts`(+test) · `frontend/src/components/meeting/SendToDflowDialog.tsx`(+test)
output_format: 항목별 변경 · 핵심 diff · 검증 명령 실제 출력 · 설계 판단 · 브리프 이탈
근거: 워크리스트 §4 `W19`(`:157`)·`W7`(`:145`) · `decisions-final-2026-07-27.md` §2-C

## ⚠️ 배포하지 않는다 — 구현만

2차 항목이다. **D'Flow R2(`MINUTES_FOLDER_PATH_ENABLED=true`) 이후에만 배포.** `main` 병합 금지.
브랜치 `feature/dflow-minutes-folder-path`에 커밋만 쌓는다(커밋은 오케스트레이터가 한다 — 너는 하지 말 것).

## 순서: W19 → W7

---

## 1. W19 — upload 응답 pass-through

`meeting_dflow_controller.rb#upload`가 `DflowUploadService.call(...)`의 **반환값을 통째로 버리고** `dflow_status_json(@meeting)`(4필드)만 렌더한다. D'Flow가 `folder_id`·`folder_path`를 실어 보내도 **프런트에 도달하지 않는다.**

→ 서비스 반환값에서 `folder_id`·`folder_path`를 꺼내 upload 응답에 **함께** 싣는다.

### ⚠️ 병합 지점은 `#upload`의 render 자리다 — `#dflow_status_json`이 아니다

공용 헬퍼에 필드를 밀어 넣으면 편철 정보가 없는 `status`·`link`·`claim` 응답까지 따라붙어, `W9`가 `DflowUploadResult`를 `DflowMeetingStatus`와 **분리해 둔 이유가 무너진다**(타입이 거짓말이 된다). `W17`·`W14`도 같은 헬퍼를 다른 목적으로 쓰므로 충돌 지점이다.

### ⚠️ 3값 규약을 뭉개지 말 것

`frontend/src/api/dflow.ts#DflowUploadResult` 주석에 이미 적혀 있다:
- **키 부재(`undefined`)** — 백엔드가 아직 에코하지 않음 / D'Flow 구버전
- **`null`** — 미분류(어느 폴더에도 안 들어감)
- **`[]`** — 팀 루트 편철 **성공**

→ D'Flow 응답에 키가 **없으면 우리 응답에도 넣지 말 것**(`nil`로 채우면 "미분류"로 거짓말이 된다). `W14`의 `dflow_archived`가 `item.key?("archived")`로 같은 규율을 지킨다 — 그 선례를 따르라.

### 확인할 것

`DflowUploadService#call`이 **무엇을 반환하는지 먼저 읽어라.** D'Flow 응답 해시를 그대로 주는지, 가공하는지, `nil`을 주는지에 따라 구현이 갈린다. 반환값이 쓸 수 없는 형태면 서비스 쪽 최소 수정도 허용한다(단 전송 로직은 건드리지 말 것).

---

## 2. W7 — 미리보기를 편철 경로로

다이얼로그 미리보기를 **`MES / 품질 / 주간정례`** 형태의 편철 경로 표시로 바꾼다.
루트가 팀코드가 **아니면** 선택한 team이 앞에 붙는 모습을 그대로 보여줄 것 — `MES / 신규TF / 킥오프`(정규화 ② 한 칸 내림).

- `dflowAutoAssign.ts`에 경로 조립 순수 함수를 두고 테스트하라. 판정 기준은 **`W4`와 동일하게** `root === 이번 전송에 실제 쓸 team`이다(`dflowEffectiveFolderDepth`가 쓰는 그 기준). 두 곳이 갈리면 경고와 미리보기가 서로 다른 말을 한다
- `TEAM_REQUIRED_MESSAGE`(`SendToDflowDialog.tsx`)를 **"판정 불가 → 선택"** 톤으로 수정
- `teamOverride` 확정 후 재평가 — `W4` 깊이 경고와 **같은 시점**

### ⚠️ 미리보기는 "절단 전" 경로다

깊이 5 초과분은 D'Flow에서 **무통보로 잘려** 다른 경로에 안착한다(정본 §2-C, 절단 유지 확정).
→ 미리보기를 **최종 결과처럼 보이게 하지 말 것.** 최종 확인은 `W8`의 응답 에코(`folder_path_status`)다.
`W4`의 깊이 경고가 떠 있을 때는 미리보기 옆에 **"실제 저장 위치는 전송 후 확인"** 취지가 드러나야 한다. 문구는 네가 정하되 기존 UI 구조 안에서 최소로.

---

## 검증 (TDD — 테스트 먼저)

- `cd backend && bundle exec rspec spec/requests/api/v1/meeting_dflow_spec.rb`
  케이스: D'Flow 응답에 `folder_id`·`folder_path` 있음 → upload 응답에 실림 / **키 없음 → 우리 응답에도 키 없음** / `folder_id: null` → `null` 그대로 / `folder_path: []` → `[]` 그대로
  ＋ **`status`·`link`·`claim` 응답에는 이 키들이 따라붙지 않음**을 못박는 케이스 (헬퍼 오염 회귀 감지)
  ⚠️ **WebMock 없음** — 기존 `instance_double` 관례
- `bundle exec rubocop <변경 파일>`
- `cd frontend && npx tsc -p tsconfig.app.json` ← **전체 0이 기준. bare tsc는 거짓 green**
- `npx vitest run src/lib/dflowAutoAssign.test.ts src/components/meeting/SendToDflowDialog.test.tsx src/api/dflow.test.ts`

## Do NOT

- `#dflow_status_json` 공용 헬퍼에 편철 필드 추가 (위 설계)
- `W8`(`folder_path_status` 배지) 착수 — **계약 v2.4 미수령.** 필드 이름·위치·null 의미를 모른다
- `dflow_auto_title`·`buildDflowTitle`·`dflow_legacy_prefixed_title` 손대기 (`W2`·`W6` 완료분)
- `resolve_team!`·`validate_folder_path_names!`·`dflowEffectiveFolderDepth` 로직 변경 (`W3`·`W4` 완료분) — **읽고 기준을 맞추는 것은 필수**
- `main` 병합 · 커밋 · 푸시 · `db/migrate` 파일 추가 · 러닝 dev 서버 실요청 · 실 `settings.yaml` 변경

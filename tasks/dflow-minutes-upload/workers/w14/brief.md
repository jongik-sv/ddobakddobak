# brief — ddobak-W14 ＋ `include_archived` (정본 §2-B / §7-3 ①)

target_repo: /Users/jji/project/ddobakddobak
write_scope: `backend/app/controllers/api/v1/meeting_dflow_controller.rb` · `backend/spec/requests/api/v1/meeting_dflow_spec.rb` · `frontend/src/api/dflow.ts` · `frontend/src/components/meeting/SendToDflowDialog.tsx` · `frontend/src/components/meeting/SendToDflowDialog.test.tsx`
output_format: 변경 파일 · 핵심 diff 요약 · 검증 명령 결과 · 브리프 이탈이 있으면 근거
근거: `tasks/dflow-minutes-upload/artifacts/decisions-final-2026-07-27.md` §2-B · 워크리스트 §7.6

## 목적

`exists_on_dflow: false`가 **초기화·보관·삭제 3원인**을 뭉갠다. 보관(archive)인데 "초기화됨"으로 안내하면 사용자가 제시받은 두 갈래(찾기·재전송)를 **둘 다 실패**한다(목록에 없음 / 409 archived).
D'Flow가 `include_archived` 파라미터 + 응답 `items[].archived: boolean`을 R1에 낸다 → 호출부를 고쳐 **보관을 보관으로** 식별한다.

## 작업 1 — 백엔드 (`status` 액션 `:44-56` 부근)

- `list_minutes(external_id: …)` 호출에 **`include_archived: true`** 추가
- 응답에 **`dflow_archived`** 추가 — `exists_on_dflow: true`일 때만, `item["archived"]`를 그대로(`dflow_title`·`dflow_date`와 같은 자리·같은 규칙)
- ⚠️ `item["archived"]`가 **없으면 키를 넣지 말 것**(R1 이전 구버전 응답). `false`로 채우면 "보관 아님"을 단정하게 된다
- `DflowClient` 변경 불필요(`list_minutes(params={})` → `get("/minutes", params)` passthrough)

## 작업 2 — ⚠️ 이 변경이 이미 통과 중인 W17을 깨뜨린다 (필수)

`include_archived: true`가 붙는 순간 **보관분도 `exists_on_dflow: true`** 가 된다. 그러면:

1. `SendToDflowDialog.tsx:298` — `!sendResult && status?.exists_on_dflow && status.dflow_title` 조건이 참이 되어 **"…을 덮어씁니다"** 를 띄운다. 실제로는 재전송이 **409 archived**로 막힌다 → **거짓 안내**. `dflow_archived !== true` 게이트 필요
2. `:379-381` 연결 관리의 3분기(`undefined` / `true` / `false`)에 **보관 상태가 없다** → 4분기로
3. `:211` `handleManualSave`의 `fresh.exists_on_dflow === false` 경고 경로에 보관분이 더 이상 안 걸린다 → 보관도 경고 대상에 포함
4. `spec/requests/api/v1/meeting_dflow_spec.rb:142`가 **`.with(external_id: "ddobak:…")`** 정확 매처다 → 인자 추가 즉시 red. 매처를 갱신할 것

## 작업 3 — W14 UI (워크리스트 §7.6 요건 1·2)

`exists_on_dflow: false` **＋ `dflow_synced_at` 있음** → 전송 직전에 안내 + [전송] **차단**(누르면 중복 회의록이 생긴다). 갈래 제시:
[D'Flow에서 찾기]로 재연결(권장·중복 없음) / 새로 전송(새 회의록임을 명시하고 확인)

### ⚠️ 응답 2형태를 **한 빌드에서 모두** 처리하라

| | `exists_on_dflow` | `dflow_archived` | 문구 |
|---|---|---|---|
| R1 이전 · 보관분 | `false` | 키 없음 | **"D'Flow에서 확인되지 않습니다(초기화·보관·삭제 중 하나)"** — 원인 단정 금지 |
| R1 이전 · 초기화/삭제 | `false` | 키 없음 | 〃 (구분 불가) |
| R1 이후 · 보관분 | `true` | `true` | **"D'Flow에서 보관됨"** ＋ 복구 = **D'Flow에서 보관 해제**. 재전송은 409로 막히니 권하지 말 것 |
| R1 이후 · 초기화/삭제 | `false` | 키 없음 | 위 (b) 문구 |

판정은 **`dflow_archived === true`** 로만. `undefined`는 "모름"이지 "아님"이 아니다 — W17이 `item.present?` 대신 `!item.nil?`를 쓴 것과 같은 규율이다.
`dflow_synced_at`이 **없으면** 이 안내를 띄우지 말 것(수동 입력 직후 등 정상 상태).

## 작업 4 — 타입

`frontend/src/api/dflow.ts` `DflowMeetingStatusWithExists`에 `dflow_archived?: boolean` 추가(주석에 "R1 이전엔 키 부재" 명시). `DflowUploadResult`엔 넣지 말 것(upload 응답엔 없다).

## 검증 (TDD — 테스트 먼저)

- `cd backend && bundle exec rspec spec/requests/api/v1/meeting_dflow_spec.rb` — 케이스: 호출 인자에 `include_archived: true` 포함 / `archived: true` → `dflow_archived: true` / `archived` 키 없음 → `dflow_archived` 키 없음. **WebMock 없음** — 기존 `instance_double` 관례 유지
- `cd frontend && npx tsc -p tsconfig.app.json` ← **전체 0이 기준. bare tsc는 거짓 green**
- `npx vitest run src/components/meeting/SendToDflowDialog.test.tsx src/api/dflow.test.ts` — 기존 36건 **전부 유지**하며 추가. 특히 `:211`·`:254`·`:298` 관련 기존 케이스가 이 변경으로 의미가 바뀌면 **삭제하지 말고 갱신**
- `cd backend && bundle exec rubocop <변경파일>` · `cd frontend && npx eslint <변경파일>`

## Do NOT

- `minutes` 프록시 액션(`:108-110`)의 `params.permit`에 `include_archived` 추가 — **살아 있는 호출자는 `linked=false` 후보 검색뿐이고 그 조합엔 절대 켜면 안 된다**(보관분은 claim 불가·409). `linked=true` 순회는 4차(W15·W16)이며 코드가 아직 없다
- `dflow_status_json` 공용 헬퍼에 필드 추가 — `upload`·`link`·`claim`엔 `list_minutes` 왕복이 없다(W17과 같은 함정)
- `upload` 액션 손대기(`ddobak-W19`, 2차 소관) · 2차 이후 항목 착수
- `db/migrate`에 파일 추가 · 러닝 dev 서버 실요청 · 실 `settings.yaml` 변경 · 커밋·푸시

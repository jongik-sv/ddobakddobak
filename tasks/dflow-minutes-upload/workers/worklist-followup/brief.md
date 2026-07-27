# brief — 워크리스트 후속 패스: 완료 항목에 **실제 구현** 반영

target_repo: /Users/jji/project/ddobakddobak
write_scope: `tasks/dflow-minutes-upload/artifacts/ddobak-folder-path-worklist-2026-07-27.md` **단 하나**
output_format: 변경한 행·절 목록 · 문서↔코드 불일치를 발견했으면 그 내용
근거: 커밋 `3c95e934`(코드) · `artifacts/exec-state.md` · 실제 소스

## 배경

`W1`·`W9`·`W17`·`W14`가 **구현 완료돼 커밋됐다**(`3c95e934`). 그런데 워크리스트 §4 작업표는 **아직 "앞으로 할 일" 문체**이고, 일부 행은 실제 구현과 **위치·서술이 다르다**. 다음 사람이 이 표를 읽고 코드를 찾을 수 있어야 한다.

**작업지시 문체를 유지하되**(이건 작업지시서다), 완료 항목에는 **"실제 구현" 한 덩어리를 덧붙인다.** 원래 지시 문장을 지우지 말 것 — 왜 그렇게 만들었는지가 남아야 한다.

## 1. `W14` 행 (`:150`) — 현재 한 줄뿐이다. 확장하라

실제 구현(직접 코드를 열어 확인할 것):
- **백엔드** `backend/app/controllers/api/v1/meeting_dflow_controller.rb` `status` 액션 —
  `list_minutes(external_id:, include_archived: true)` ＋ 응답에 `dflow_archived`.
  ⚠️ **`item.key?("archived")`일 때만** 싣는다(R1 이전 구버전 응답이면 키 자체를 안 넣는다 — `false`로 채우면 "보관 아님"을 단정하게 된다)
- **타입** `frontend/src/api/dflow.ts` — `DflowMeetingStatusWithExists.dflow_archived?: boolean`. `DflowUploadResult`엔 없음
- **UI** `frontend/src/components/meeting/SendToDflowDialog.tsx` —
  `dflowMissing`(= `exists_on_dflow===false` ＋ `dflow_synced_at` 있음) → 안내 ＋ **[전송] 차단** ＋ 갈래 2개
  (「D'Flow에서 찾기로 재연결」 = 연결 관리를 펼치고 검색 패널 오픈 / 「새로 전송」 = `confirmDialog` 확인 후에만 전송).
  `dflowArchived`(= `exists_on_dflow===true` ＋ `dflow_archived===true`) → "보관됨" 안내, **전송은 차단하지 않음**
- **설계 판단(근거를 반드시 남길 것)**: 보관분 [전송] 미차단 —
  ① D'Flow 409가 "보관된 회의록입니다. 복원 후 다시 시도하세요."를 정확히 실어 오므로 클라이언트가 선차단하면 그 안내 경로가 사라진다
  ② 방금 D'Flow에서 보관 해제한 사용자가 stale 플래그로 락아웃된다
- **`include_archived`를 조회 프록시(`minutes` 액션)의 `params.permit`에 넣지 않았다** — 살아 있는 유일한 호출자가 `linked=false` 후보 검색이고 그 조합은 금지(보관분은 claim 불가·409). `linked=true` 순회는 `W15`·`W16` 소관
- 검증: rspec 75 pass · vitest 전체 1816 pass · `tsc -p tsconfig.app.json` 0 · rubocop/eslint clean

## 2. `W17` 행 (`:153`) — **행 번호가 낡았고 위치 편차 2건이 안 적혀 있다**

- 행 머리의 `meeting_dflow_controller.rb:38-45`는 **더 이상 그 줄이 아니다.** 실제 파일을 열어 `status` 액션의 현재 위치로 갱신할 것(주석이 늘어 아래로 밀렸다)
- **위치 편차 2건**(둘 다 정당 — 근거와 함께 적을 것):
  1. 백엔드 — 지시는 `dflow_status_json`(공용 헬퍼)을 지목했으나 **`status` 액션**에 얹었다. `upload`·`link`·`claim`엔 `list_minutes` 왕복이 없다
  2. 프런트 — 연결 관리 `<details>`(기본 **접힘**) 안이 아니라 **[전송] 버튼 바로 위**. 접힌 곳에 두면 처음 전송하는 사용자가 경고를 **절대 못 본다** → W17 목적 자체가 무너진다
- **W14가 W17을 깨뜨릴 뻔한 지점**을 남길 것: `include_archived`가 붙으면 보관분이 `exists_on_dflow: true`가 되어 "덮어씁니다" 안내가 **거짓**이 된다(재전송은 409). → 덮어쓰기 배지에 **`dflow_archived !== true` 게이트**를 걸었다. 함께 손본 곳: 연결 관리 존재 확인 표시를 **4분기**(모름/존재함/**존재함(보관됨)**/존재하지 않음)로, 수동 입력 경고를 `missing`/`archived` 2분기로, spec의 `.with(external_id:)` 정확 매처 갱신

## 3. `W1`·`W9` 행 — 구현 반영 확인

- **`W1`**: `dflow_folder_chain`이 **private**(`meeting.rb`)이라 지시 리터럴이 `NoMethodError`였다 → **`Meeting#dflow_folder_path_names`** 공개 접근자 신설(`chain.reverse.map(&:name)`). 기존 `dflow_root_folder_name`(`.last`)·`dflow_sub_folder_name`(`[-2]`) 패턴과 동일 — **leaf-first 풋건을 모델에 가둔다**. 행에 이 사실이 없으면 추가할 것
- **`W9`**: optional 허용이 이미 반영돼 있는지 확인만. 없으면 추가

## 4. 상태 표기 정합

§4 표의 상태 칸(`✅` 등)이 "필수 여부"를 뜻하는지 "완료 여부"를 뜻하는지 **현재 표의 의미를 먼저 파악하고**, 완료 항목을 나타내는 별도 표기가 없으면 **행 안에 `**구현 완료(커밋 3c95e934)**` 같은 표식**을 넣어라. 열 의미를 임의로 바꾸지 말 것.

## Do NOT

- 다른 파일 수정 — 이 워크리스트 **1개만**
- 원래 지시 문장 삭제 (왜 그렇게 만들었는지가 남아야 한다)
- 2차 이후 항목(`W2`~`W8`·`W12`~`W16`·`W18`·`W19`)의 내용 변경 — 완료 항목만 손댄다
- 코드 수정 · 커밋 · 푸시

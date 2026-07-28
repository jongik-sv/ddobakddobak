# 실행 원장 — `folder_path` 작업

> 절차: `exec-loop-prompt-2026-07-27.md`
> 근거: `ddobak-worklist-sync-gap-2026-07-27.md` · `worklist-conflict-audit-2026-07-27.md`
> 수정 대상: `ddobak-folder-path-worklist-2026-07-27.md` (단일 파일)

시작: 2026-07-27 13:55

---

## Phase 0 — 문서 정합 (14건)

디스패치 묶음: 같은 파일을 고치므로 **순차** 실행. 절 단위로 나눈다.

| 묶음 | 항목 | 대상 절 | 상태 |
|---|---|---|---|
| **A** | D0-1 · D0-8 · D0-9 · D0-10 · D0-12 · D0-13 | §7 | **DONE** (14:05, 서브에이전트) |
| **B** | D0-2 · D0-6 · D0-7 · D0-4(§1 표) | §1 · §3 · §4 | **DONE** (14:4x, wf_858726c2) |
| **C** | D0-3 · D0-4(§5 본문) · D0-5 · D0-16 | §5 · §8 | **DONE** (14:4x, wf_858726c2) |
| **D** | D0-11 · D0-15 | §6 · §7.7 | **DONE** (14:4x, wf_858726c2) |
| **E** | D0-14 최종 대조 | 전체 | **DONE** — 축 1·3·4·5 PASS / 축 2·6 FAIL. 잔여 11건 + 신규 갭 4건 |
| **R1** | F1 · F5 · F6 · N1 · N2 · D0-17(W19 신설) | §4 · §7 | **DONE** (15:1x, wf_411b7095) |
| **R2** | F2 · F3 · F4 · F7 · N3 · W19 차수 | §5 · §6 · §8 | **DONE** (15:1x, wf_411b7095) |
| **R3** | 재검증 | 전체 | **DONE** — F1~F7·N1~N3·D0-17 **전건 PASS**, **회귀 0**, 미결 4/4 유지. 잔여 6건(F-a·G1~G5) |
| **R4** | F-a · G1~G5 마무리 | §4 · §5 · §8 | **DONE** (15:2x) — `ddobak-W18`을 **0차**(계약서 선행)로 라벨 분리, §8에 W19 기준 신설, `A §11.2` 표기 오염 제거 |
| **R5** | 0차 행을 표 맨 위로 (라벨↔순서 정합) | §5 | **DONE** — `0차 → 1차-a → 1차-b → 2차 → 3차 → 4차` 확인 |
| **R6** | §4 W9 행에 optional 허용 반영 (문서↔코드 정합) | §4 | **DONE** — Phase 1 구현이 `?`로 나갔는데 문서는 필수 필드였다. `dflow-W4` 배포 전엔 두 키가 응답에 없어(`undefined`) 필수 고정 시 W8이 `undefined.join`으로 깨진다는 근거와 함께 확정 반영 |

### Phase 0 종료 실측 (2026-07-27 15:30)

| 항목 | 값 |
|---|---|
| 워크리스트 행수 | 385 → **518** |
| §4 W 항목 | 17 → **19** (W18 api-spec 동기화 · W19 백엔드 pass-through 신설) |
| §5 배포 차수 | 4단 → **6단** (0차 · 1차-a · 1차-b · 2차 · 3차 · 4차) |
| 미결 유지 | **4/4** — 임의 결론 0건 (R3 검증) |
| §5·§7.3 접두 없는 `W` | 3건 잔존, 전부 `§4 W18`·`(§4 W8·W19)` 형태로 **절 번호가 소속을 못박음** (R3이 FAIL로 세지 않음) |
| 에이전트 | 12 (서브에이전트 3 + Workflow 10 중 9) · 토큰 ~993k · 에러 0 |

### 항목

- [x] **D0-1** (갭 B-1) §7.2-2 team 취급 정정 — 배치는 team 미전송(§7.4 (a)). `failed(team_mismatch)` 함정
- [ ] **D0-2** (갭 C) api-spec 사본 동기화 작업 신설 — dflow-W8 완료 후 실행, 방향 wbs-web→또박또박
- [ ] **D0-3** (갭 A①⑦) §5 배포표 재구성 — 1차=`W1·W9·W10·W11`, W4·W6·W7→2차, W14·W17→1~2차. §8 수용기준 귀속 W2→W6
- [ ] **D0-4** (갭 A⑤) §5 W3 선배포 금지 근거 정정 + §1 표 "전송 자체 실패" 정정
- [ ] **D0-5** (갭 A) §5 배포표 W 번호에 `ddobak-`/`dflow-` 접두
- [ ] **D0-6** (갭 A②) W8 `권장`→`✅` 승격 + 차수 배정(dflow-W4 의존)
- [ ] **D0-7** (갭 B-3) §3.3 미분류 폴백 `folder_path: null` 서술 + W9 nullable 요구
- [x] **D0-8** (갭 A③) §7.7 대상 2에 `dflow_synced_at.present?` 추가
- [x] **D0-9** (갭 A④) §7.7 C2 W2 전/후 변형 분기 명시
- [x] **D0-10** (갭 B-2·B-4) §7.2-5 로그 카테고리 6종 + `already_correct` 선후
- [ ] **D0-11** (갭 D-1~D-5) §6에 인지 항목 5줄
- [x] **D0-12** (갭 B-5) ⚠️ §8.3 판정기준 미결 등재 — 결론 금지
- [x] **D0-13** (갭 B-6) ⚠️ archived 오진 미결 등재 + §7.6·W14 문구 완화
- [ ] **D0-14** 최종 정합 확인 — 두 워크리스트 §3·§5/§11.2·§7/§8 대조

### 묶음 A가 새로 만든 항목 (하류 파급)

- [ ] **D0-15** §7.7 **대상 1 정의 확장** — D0-8이 대상 2에 `dflow_synced_at` 조건을 넣으면서 사각지대가 생겼다:
      `public_uid` 있음 + `dflow_synced_at` **없음** + `exists_on_dflow: false`(= 전송 실패분·수동 연결분)가
      대상 1(`public_uid` 없음)에도 대상 2(초기화분)에도 안 걸린다. **링크가 가장 필요한 회의가 대상에서 통째로 빠진다.**
      → 대상 1 기준을 "`public_uid` 없음"이 아니라 **"`dflow_synced_at` 없음(= 한 번도 전송 안 됨)"** 으로 넓힌다.
      D'Flow §11.3 ③의 의도가 이것이다("실제로는 '한 번도 안 올라간' 대상 1인데 대상 2로 분류돼").
- [ ] **D0-16** §8 수용 기준(약 397행)이 옛 문구 **"연결 해제되었습니다"** 를 그대로 쓴다 —
      D0-13이 §7.6 문구를 "확인되지 않습니다(초기화·보관·삭제 중 하나)"로 바꿨으므로 수용기준도 동기화.

---

## Phase 0 라운드 2 — E 검증 잔여 (또박또박 문서만 수정)

### B 잔여 (고쳐야 함)

- [ ] **F1** [med] §7.3에서 토큰 `W3`가 dflow-W3(`resolveFolderPath`)와 ddobak-W3(`resolve_team!`) 둘을 동시에 가리킴 → §7.3 전체 접두화
- [ ] **F2** [med] W8이 ✅ 승격됐는데 §8 수용기준에 대응 항목 0개 → 에코 표시 · `folder_id: null` 미분류 문구 2줄 추가
- [ ] **F3** [med] §8의 W14 기준 "초기화한 회의를 열면…"이 1차-b(dflow-W10 이전)엔 **트리거 자체가 없음** → "dflow-W10 이전엔 보관(archive) 케이스로 검증" 1줄
- [ ] **F4** [low] §8 마이그레이션 기준에 `already_correct`·`no_team_root` 검증 없음 → 2줄
- [ ] **F5** [low] §7.4가 이미 타결된 `items[].team` 선택 필드를 "요청할 것"으로 남김 → "D'Flow §8.2에 수용됨"
- [ ] **F6** [low] §4 W3 행이 여전히 "TeamRequiredError 대신…자유 루트도 전송 성공"으로 새 능력처럼 읽힘 → "override 경로는 이미 라이브, W3은 정식화"
- [ ] **F7** [low] `ddobak-W18`(api-spec 동기화)이 2차인데 dflow-W8은 **착수 전 선행** → 1차-b로 당기거나 "1차 착수 전 권장"

### 신규 갭 (양 문서 어디에도 없던 것)

- [ ] **N1** [med] (감사 R4-6) 자동 링크 claim을 컨트롤러 액션으로 지시했는데 그 액션은 `authenticate_user!`·`editable_by?`에 묶여 **rake에서 호출 불가**. `DflowClient#link_minute` 직접 호출 시 `ensure_dflow_public_uid!`·`dflow_url` 조립이 빠져 **`dflow_url`이 nil** → 공용 서비스 객체 추출 + 수용기준 1줄
- [ ] **N2** [med] (감사 R4-8) §7.7 역연산이 "완전 복구"처럼 읽힘. 되돌아가는 건 **연결**이지 본문 아님 — `replace` 실행분의 본문 복구는 **별건 미정** → 역연산 서두 1줄 + §6 인지 1행
- [ ] **N3** [low] 깊이 초과 **무통보 절단** 정책 비대칭(60자는 400 거절)이 B에 미결로 없음. W7 미리보기는 **절단 전** 경로 표시 → §6 인지 1행 + W7 행에 주의 1구
- [x] **N4** [참고] B가 추가한 `already_linked` 게이트 — A·감사·갭보고에 없던 신규 안전장치. 충돌 없음, 유지

### Phase 1이 발견한 누락 작업

- [ ] **D0-17 (W19 신설)** ⚠️ `meeting_dflow_controller.rb#upload` 액션이 `DflowUploadService.call`의 **반환값을 버리고** `dflow_status_json`(4필드)만 렌더한다. dflow-W4가 배포돼도 **또박또박 백엔드가 `folder_id`·`folder_path`를 프런트로 넘기지 않아 W8이 표시할 값을 못 받는다.** 워크리스트 §4가 W8 전제를 `dflow-W4`만으로 적은 것은 불완전 → 백엔드 pass-through W 신설(2차)

---

## Phase 1 — 1차 코드 (4건) — **DONE**

- [x] **W1** `dflow_upload_service.rb` — `folder_path: @meeting.dflow_folder_path_names` 추가.
      ⚠️ `dflow_folder_chain`이 **private**(`meeting.rb:603`)이라 지시 리터럴이 `NoMethodError`(15 failures 실증)
      → `meeting.rb`에 public 접근자 `dflow_folder_path_names`(`chain.reverse.map(&:name)`) 신설.
      기존 `dflow_root_folder_name`(`.last`)·`dflow_sub_folder_name`(`[-2]`) 패턴과 동일 — leaf-first 풋건을 모델에 가둠.
      전송 호출부 1곳(`upload_minute`) grep 확인, `DflowClient#post`는 화이트리스트 없어 와이어에 실림
- [x] **W9** `frontend/src/api/dflow.ts` — `DflowUploadResult` 파생 인터페이스 신설(`folder_id?: string | null`, `folder_path?: string[] | null`).
      ⚠️ 지시는 필수 필드였으나 **optional(`?`)로 완화** — 오늘 응답엔 두 키가 아예 없어(=`undefined`) 필수로 고정하면
      W8 구현자가 `undefined.join` TypeError를 만난다. `?`는 nullable 요구를 **대체가 아니라 추가**(`string|null|undefined`).
      공통 `DflowMeetingStatus`에 넣지 않음 — status·link·claim 응답엔 편철 정보가 없어 타입이 거짓말이 된다
- [x] **W10-backend** `spec/services/dflow_upload_service_spec.rb` +3 케이스 — root-first 전체 배열 동등 · 폴더 없음 `[]`(키 존재까지) · 단일 폴더.
      ⚠️ **W10은 부분 완료** — 워크리스트 W10 행의 `dflowAutoAssign.test.ts`·`SendToDflowDialog.test.tsx`는 W6/W8 검증이라 2차분.
      **통째로 완료 표기 금지**
- [x] **W11** `ddobak-dflow-sender-spec.md` v1 → **v1.1** (+65 −20). §1.3 team 판정(판정 실패 ≠ 전송 차단, 편철 3분기),
      §1.4 제목(접두 폐기 D2, 실효 지점=`buildDflowTitle`, 접두 헬퍼는 §7.7 C2용으로 **보존**, 소급 수정 없음),
      **§1.6 `folder_path` 전송 신설**. 파생 서술 8곳 정합화. 계약 사본은 **무변경 확인**(W18 소관)

### Phase 1 검증 결과

| 명령 | 결과 |
|---|---|
| `rspec spec/services/dflow_upload_service_spec.rb` (구현 전) | 19 passed / **3 failed** (red 확인) |
| 〃 (구현 후) | **22 passed / 0 failed** |
| `rspec spec/models/meeting_spec.rb spec/services/dflow_client_spec.rb spec/requests/settings_dflow_spec.rb` | **85 passed** (meeting.rb 회귀 없음) |
| `rubocop` (3파일) | ok |
| `npx tsc -p tsconfig.app.json` | **No errors found** (기준선 0 유지) |
| `npx vitest run src/api/dflow.test.ts src/components/meeting/SendToDflowDialog.test.tsx` | **33 PASS / 0 FAIL** |

---

## 1차-b — D'Flow 의존 0

- [x] **W17** 덮어쓸 D'Flow 회의록 제목·날짜 표시 (2026-07-27 완료)
      - 백엔드: `status` 액션에 `dflow_title`·`dflow_date` (`exists_on_dflow: true`일 때만)
      - 프런트: `dflow.ts` 타입 nullable + `SendToDflowDialog.tsx` 표시
      - 검증: rspec **31 pass** · rubocop ok · `tsc -p tsconfig.app.json` **0** · vitest **36 pass** · eslint clean
      - ⚠️ **워크리스트 위치 편차 2건**(둘 다 정당, W17 행에 반영 완료):
        1. 백엔드 — `dflow_status_json` 공용 헬퍼가 아니라 `status` 액션.
           `upload`·`link`·`claim`엔 `list_minutes` 왕복이 없어 값 없는 필드가 따라붙거나 왕복이 3번 는다(`ddobak-W19`와 같은 함정)
        2. 프런트 — 연결 관리 `<details>`(기본 **접힘**) 안이 아니라 **전송 버튼 바로 위**.
           접힌 곳에 두면 처음 전송하는 사용자가 펼치지 않는 한 경고를 **절대 못 본다** → W17 목적(전송 직전 오매칭 경고) 자체가 무너진다
      - 부수: `exists_on_dflow` 판정을 `.any?` → `item = items.first; !item.nil?`로 바꾸면서
        `item.present?`를 썼다면 D'Flow가 빈 해시 `{}`를 반환하는 케이스에서 의미가 뒤집혔을 것 — `!item.nil?`로 원래 의미 보존
- [x] **W14 ＋ `include_archived`** 연결 해제 대응 (2026-07-27 완료) — B-4가 **(a)로 확정**되고 `dflow-W24`가 R1에 포함되면서 착수 가능해졌다.
      정본 §7-3 ①과 **한 몸**이라 함께 처리(따로 하면 오진이 그대로 남아 죽은 기능이 된다).
      - 백엔드: `status`가 `list_minutes(external_id:, include_archived: true)` 호출 + `dflow_archived`를 **`item.key?("archived")`일 때만** 실음
        (R1 이전 구버전 응답이면 키 자체를 안 넣는다 — `false`로 채우면 "보관 아님"을 단정하게 된다)
      - 프런트: `exists_on_dflow:false` ＋ `dflow_synced_at` 있음 → "확인되지 않습니다(초기화·보관·삭제 중 하나)" + **[전송] 차단** + 갈래 2개
        (재연결 / 새로 전송은 confirm 후). 보관분(`dflow_archived:true`)은 별도 안내, **[전송]은 차단하지 않음**
      - ⚠️ **이 변경이 W17을 깨뜨릴 뻔했다** — `include_archived`가 붙으면 보관분이 `exists_on_dflow:true`가 되어
        "덮어씁니다" 안내가 **거짓**이 된다(재전송은 409). 회귀 4곳 차단(행 번호는 커밋 `3c95e934` 기준 실측):
        `SendToDflowDialog.tsx:333` 덮어쓰기 게이트 · `:447-453` 존재확인 4분기 · `:509-518` 수동입력 경고 2분기 ·
        `meeting_dflow_spec.rb:144`의 `.with(external_id:)` 정확 매처.
        ⚠️ 이 원장의 이전 판(`:298`·`:378`·`:211`·`:142`)은 **전부 낡은 값이었다** — 주석·코드가 늘며 밀렸다.
        문서에 행 번호를 옮겨 적기 전에 반드시 실측할 것
      - ⚠️ **`minutes` 프록시(`:108-110`)의 `params.permit`에는 일부러 넣지 않았다** — 살아 있는 유일한 호출자가
        `linked=false` 후보 검색이고 정본 §2-B가 그 조합을 금지한다(보관분은 claim 불가·409). `linked=true` 순회는 4차
      - 검증: rspec **75 pass** · rubocop ok · `tsc -p tsconfig.app.json` **0** · vitest **45 pass**(기존 36 + 신규 9) · eslint clean
      - 설계 판단: 보관분 [전송] 미차단 — D'Flow 409가 정확한 복구 안내를 실어 오므로 선차단하면 그 경로가 사라지고,
        방금 보관 해제한 사용자가 stale 플래그로 락아웃된다
      - 후속(저우선): 연결 관리의 "존재하지 않음(다음 전송 시 새로 생성됩니다)" 문구가 상단 "원인 미단정" 안내와 결이 다르다

---

## Phase 2+ — 블록 (D'Flow 미착수)

> ⚠️ **이 절은 2026-07-27 시점 기록이다.** 2026-07-28 세션 3에서 `W18`·`W12`·`W13`·`W8`의 차단 사유(계약 v2.4 결핍)가 해소됐다 — 아래 목록의 "0차"·"3차" 줄은 stale하다. 최신 상태는 **Phase 4** 참조.

wbs-web `main`에 `folder_path` 커밋 0건 (2026-07-27 확인).

- 2차 `W2·W3·W4·W5·W6·W7` ← dflow-W1~W5
- **0차** api-spec 사본 동기화(`ddobak-W18`) ← dflow-W8. **1차 코드 착수 전 권장, 3차 착수 전 필수** (R2에서 2차 → 앞당김)
- 2차 `ddobak-W19`(백엔드 pass-through) ← dflow-W4. 줄기 = W9(1차-a 타입) → W19(값 전달) → W8(표시)
- 3차 `W12·W13` ← dflow-W6 (⚠️ D0-12 결정이 2차 앞으로 당길 수 있음)
- 4차 `W15·W16` ← dflow-W10

---

## ⚠️ D'Flow 확정본이 stale해짐 — 또박또박이 고칠 수 없음 (팀장 전달 필요)

또박또박이 D'Flow §11.3 요청 7건을 **정확히 이행한 결과**, D'Flow 문서가 인라인해 둔 옛 표가 뒤처졌다.
`dflow-folder-path-worklist-2026-07-27.md`는 확정본이라 이쪽에서 수정하지 않았다.

- **F8** [med] A §11.1 표제가 `ddobak-W1~W17` — 신설된 **`ddobak-W18`(api-spec 동기화)·`ddobak-W19`(백엔드 pass-through) 2건**이 없다. A:695 잠금해제 표에서 `dflow-W8` 행이 `ddobak-W18`을, `dflow-W4` 행이 `ddobak-W19`를 지목해야 함
- **F9** [med] A §11.2 차수표가 ①⑦ **적용 전 상태 그대로** (1차에 `ddobak-W4·W6·W7`, 4차에 `W14·W17`). A §0:24도 함께 어긋남.
  ⚠️ **R2로 악화** — 이제 누락(F8)에 더해 **차수까지 어긋난다**: `ddobak-W18`이 2차 → **0차**(계약서 선행)로 이동했다
- **F10** [med] A §11.1 W14 행이 `"연결이 해제되었습니다"` 배지 — **A 자신의 §9.7 (b)안**("확인되지 않습니다(초기화·보관·삭제 중 하나)")과 모순. 또박또박은 (b) 문안을 채택했다
- **F11** [low] A §11.1 W8 행이 아직 "현재 '권장' → 필수 승격 **요청**" — 이미 ✅ 승격·2차 배정 완료

---

## Phase 2 마무리 라운드 (2026-07-27 밤)

| 라운드 | 내용 | 결과 |
|---|---|---|
| **커밋** | 코드·문서 분리 커밋 | `3c95e934`(코드) · `212d5519`(문서) · `0852ac4b`(방어 수정) — **푸시 안 함** |
| **review** | 커밋 `3c95e934` 적대적 리뷰(읽기 전용) | 결함 4건. 클린: root-first 순서·사이클 가드·전송 차단 우회·상태 타이밍·매처 엄격성 |
| **fix-guards** | 리뷰 결함 2건 TDD 수정 | rspec **134 pass** · rubocop clean → `0852ac4b` |
| **followup** | §4 완료 항목(W1·W9·W14·W17)에 실제 구현 반영 | 행 번호 4곳 실측 정정 |
| **staleref** | 낡은 인용 정리 → **심볼 기준 전환 25건** | 문서 상단에 인용 규약 신설 |

### ⚠️ 오늘 얻은 가장 실용적인 교훈 — 행 번호 인용은 썩는다

하루에 **세 라운드** 밀렸다: W14 구현이 `status`를 늘리고 → `fix-guards`가 또 늘리고 → 그 아래 인용이 통째로 스테일.
그리고 **틀린 인용은 조용하다** — 실측에서 이런 것들이 나왔다:

| 문서가 가리키던 곳 | 실제로 열리는 코드 |
|---|---|
| `§7.6`의 `PUT /dflow/link` = `controller.rb:47-54` | **`status` 액션 몸통** |
| `meeting.rb:601-605`(`dflow_folder_chain`) | **`previous_meeting_not_self`** (완전히 다른 메서드) |
| `dflow.ts:47`(`titleOverride` 처리) | **인터페이스 닫는 빈 줄** |
| `SendToDflowDialog.tsx:253`(team 셀렉트 체인) | **`handleManualSave` 내부** (무관) |

전부 "그럴듯한 다른 코드"라 열어봐도 틀린 줄 모른다.
→ **인용 규약: `file#symbol` 우선. 행 번호를 남길 땐 기준 커밋을 함께.** 워크리스트 §4 표 위에 명문화했다.

＋ **앞 패스의 실측을 믿지 말 것** — `followup`이 잰 `link`(`:64-86`)·`handle_upload_precondition_error`(`:167-176`)가 각각 **4줄씩 틀렸다**(실제 `:68-90`·`:171-180`). `staleref`에 "다시 재라"고 지시하지 않았으면 그대로 이식됐다.

### 리뷰 결함 4건 처리

| 심각도 | 내용 | 처리 |
|---|---|---|
| med | `resp["items"].to_a.first` — `items`가 Hash면 pair 배열이 되어 `exists_on_dflow` 오판정 ＋ `item["title"]`에서 TypeError **500**. **`3c95e934`가 만든 회귀**(이전 `.to_a.any?`는 안전) | ✅ `0852ac4b` |
| low | `item.key?("archived")`가 `"archived": null`을 못 거름 → 타입 계약 위반 | ✅ `0852ac4b` |
| med | `include_archived` 무조건 전송 — 구버전 D'Flow가 400이면 status 전건 파손(추정) | **코드 가드 불필요** — 정본 §3 제약 ①(`dflow-W24 ≤ ddobak-W14`)이 R1 선행을 강제. 회신문에 확인 요청 1줄 추가 |
| med | `DflowUploadResult.folder_id/folder_path`가 미배선 죽은 필드 | 기지 사항 — `ddobak-W19`(2차)로 등재됨 |

---

## 확인 필요 (팀장 판단 대기) — **전건 해소** (`decisions-final-2026-07-27.md`, 2026-07-27 수령)

| 미결 | 확정 |
|---|---|
| §8.3 `manual_placement` 판정기준 | **(c) 조상 규칙** — (a)/(b) 이지선다에 없던 제3안. 스키마 변경 0·순서 교체 불필요. 또박또박 코드 변경 **0** |
| `exists_on_dflow: false` archived 오진 | **(a)** D'Flow가 `include_archived` ＋ `archived` 노출. **R1에 포함**(W10 아님) → `ddobak-W14` 1차-b 완결 |
| §3.3 미분류 폴백 응답 | **`folder_id: null` ＋ `folder_path: null`** 확정 ＋ 배치 `from`도 nullable |
| 배치 `ACTOR_EMAIL` | **`donseok75@gmail.com`**(실명·`pmo_admin`) ＋ 배치에 `pmo_admin` 게이트 신규 |

---

## 실서버 실측 (2026-07-27, 사용자 승인 후 읽기 전용 SELECT) — `artifacts/prod-survey-2026-07-27.md`

| 정본 §7 | 답 |
|---|---|
| **1** `ddobak-W1` 프로덕션 배포 | **아니오** — 커밋조차 안 됨(워킹 트리) |
| **2** 폴더 깊이 분포 | **5단 이상 0건**, 실효 최대 **2**. 살아있는 폴더 트리도 2단 |
| **7** `[]`로 나갈 회의 | 연동 18건 중 **1건**, D'Flow에서도 이미 팀 루트 → **평평화 피해 0** |
| **11** 중복 의심 | **해명 — 중복 전송이 아니라 `claim` 오매칭** ＋ 삭제 미전파 |
| **§8 부록 19건 `to`** | 전량 완성. `moved` 1 / `already_correct` 11 / `manual_placement` **6** / items 제외 1 |

### 실측이 만든 신규 항목 2건

- **N5** [high] ⚠️ **`D0-15`가 실측과 충돌한다.** `dflow_synced_at`이 NULL인데 **이미 D'Flow에 연결된** 회의가 **4건**(＋삭제분 1).
  원인은 `claim`이 `dflow_url`만 갱신하는 것(`meeting_dflow_controller.rb#claim`, 정상 동작 — claim은 전송이 아니다).
  D0-15가 넓힌 §7.7 대상 1 정의("`dflow_synced_at` 없음")에 이 4건이 걸려 **다른 회의록에 재claim → 고아 + 오매칭**.
  → 대상 1 기준을 **"`dflow_synced_at` 없음 AND `exists_on_dflow == false`"** 로 정정. `public_uid` 유무는 판정 기준이 될 수 없다
- **N6** [med] **`claim` 오매칭이 이미 1건 발생했다** — 또박또박 `원료팀 2026.07.08`(07/08 녹음 55분)이
  D'Flow 수동 업로드분 `원재료_2026.07.15_11시00분`을 claim. 정본 §6의 "자동 링크 v1은 자동 claim 끄고 사람 승인만" 결정을 **실증**한다.
  유사 의심 1건 더(`_AS-IS` ↔ `_통합`) — PMO 확인 요청

---

## Phase 3 — 2026-07-28 세션 2 (`ddobak-W19`·`ddobak-W7`) — **DONE**

진행률 **11/19 → 13/19**. 오케스트레이터가 직접 실측·검증(서브에이전트 산출물을 그대로 신뢰하지 않음). ⚠️ 2차분 — **배포·`main` 병합 금지(R2 이후)**, 커밋 `a9743788`(6파일, 푸시 안 함).

| 항목 | 구현 |
|---|---|
| **`W19`** | `meeting_dflow_controller.rb#upload` — `render json: dflow_status_json(@meeting).merge(dflow_folder_echo_json(resp))`. 신규 private `meeting_dflow_controller.rb#dflow_folder_echo_json` — `resp.key?("folder_id")`/`resp.key?("folder_path")` 조건부 merge로 3값 규약(키 부재/`null`/`[]`) 보존. `#dflow_status_json` 공용 헬퍼는 무수정(status·link·claim 오염 방지). `DflowUploadService`는 무수정 — `#call`이 `client.upload_minute`(= `DflowClient#parse_response`의 `JSON.parse`, 문자열 키 Hash) 결과를 그대로 반환 |
| **`W7`** | `dflowAutoAssign.ts#dflowRootIsResolvedTeamRoot` 신설(루트=이번 전송 team 단일 판정 소스). `dflowAutoAssign.ts#dflowEffectiveFolderDepth`의 인라인 판정을 이 함수 호출로 교체(출력 불변). `dflowAutoAssign.ts#dflowFolderPreviewPath` 신설(team 한 칸 내림 노출, `resolvedTeam` null이면 접두 없음). `SendToDflowDialog.tsx` "편철 경로 미리보기" 블록 추가 + `DEPTH_WARNING_MESSAGE`·`TEAM_REQUIRED_MESSAGE` 문구 갱신 |
| **검증** | rspec **2041 passed / 0 failed**(전체, 오케스트레이터 독립 실행 674s) · vitest 전체 **1840 pass / 0 fail**(기준선 1830 + 신규 10 = `dflowAutoAssign` 7 · `SendToDflowDialog` 3) · `tsc -p tsconfig.app.json` **0** · rubocop·eslint clean |
| ⚠️ 기준선 정정 | 이전 판(rspec **659**)은 전체 스위트가 아니었다. 위 2041이 맞는 전체 실측치 — 다음 세션 재확인 시 이 줄을 기준으로 삼을 것 |

신규 문서: `team-lead-open-decisions-2026-07-28.md`(180행) — 팀장 결정 필요 9건.

---

## Phase 4 — 2026-07-28 세션 3 (소스 기준 차단 해제 + `W8`·`W12`·`W13`·`W18` + 실서버 재감사) — **DONE**

진행률 **13/19 → 17/19** (`+W8 +W12 +W13 +W18(미커밋)`). 잔여 = **`W15`·`W16` 2건**뿐(D'Flow R3 선행 필요, 변동 없음).

### 판을 바꾼 발견 — 차단 요인 ①이 사라졌다

D'Flow 소스(`/Users/jji/project/wbs-web`, GitHub `donseok/wbs-web`)는 **사내망이 아니라 사외에서도 fetch 가능**하다. 로컬 clone이 낡아 `main`=스펙 v2.2였고 문서가 인용하던 커밋이 없었는데, `git fetch` 후 `origin/feat/minutes-folder-path`에서 **계약 v2.4가 이미 존재**함을 확인했다 — 그 브랜치의 `docs/design/dflow-minutes-upload-api-spec.md` 자신이 "⚠️ 또박또박 송부본은 이 v2.4다"라고 선언한다. 즉 차단 사유는 **"계약 미작성"이 아니라 "전달 누락"**이었다. 관련 커밋: `4387576`(v2.3) · `afc1943`(배치 엔드포인트) · 브랜치 HEAD `94e5eca`. 상세: `dflow-source-findings-2026-07-28.md`.

### 완료된 W 항목 (전부 커밋됨, 푸시 안 함)

| W | 커밋 | 내용 |
|---|---|---|
| `W8` | `bceae845` | `folder_path_status` 배지(`FOLDER_PATH_STATUS_BADGE`, 키 부재·`exact`는 미렌더) + 전송 후 편철 결과 경로 표시. 백엔드 `meeting_dflow_controller.rb#dflow_folder_echo_json`에 `key?` 조건부 merge 추가, 공용 헬퍼 `#dflow_status_json`은 무수정 |
| `W12`·`W13` | `5eef05ee` | `DflowFolderMigrationService`(대상=§7.2 정의, §7.7 자동 링크 "대상 1"과 다른 개념) + `rake dflow:migrate_folders`. 삭제분 `.kept` 제외, 200건 `each_slice`, `ACTOR_EMAIL` 기본값 추측 금지, 빈 `items` dry-run 프로브로 권한 확인 |
| `W18` | `3efff4f8`(이후 `7823391` 기준 재동기화 `ae3e5915`) | 계약 사본 `v2.1 → v2.4` 동기화(원문 그대로 교체, 델타 주석 병기 안 함) |

### 검증 실측 (오케스트레이터 직접 실행)

`rspec` 전체 **2071 examples / 0 failures**(9분 16초) · `vitest` 전체 **1850 pass / 0 fail** · `tsc -p tsconfig.app.json` **0** · rubocop·eslint clean. (이전 기준선 rspec 2041 · vitest 1840에서 신규 테스트만큼 증가)

### 실서버 실측 (2026-07-28, 또박또박 SQLite 읽기 전용 SELECT + D'Flow 운영 GET 전용 API)

- **D'Flow 미배포가 실측으로 확정** — 운영 `GET /minutes?include_archived=true`가 41건을 주는데 `items[]`에 `archived` 키(v2.3 신설 필드)가 없음

상세: `team-lead-open-decisions-2026-07-28.md`(갱신, 팀장 결정 대기 6건).

### 계약 대조 결과

`decisions-final-2026-07-27.md` §2-E의 v2.4 반영 9건 **전부 충실 반영, 다르게 반영된 것 0건**(⚠️ §2-E 9행 표 수준의 대조 — §2-A·§2-C·§2-D·§2-H·§2-J 본문 논거까지 문장 단위 대조는 안 함). 배치 응답에는 `folder_path_status` 값 중 **`exact`·`truncated` 둘만** 실제로 나온다(`partial`·`unclassified`는 §4c.3에 따라 `failed`로 전환돼 `moved`에 도달하지 않음). 상세: `dflow-contract-v23-delta-2026-07-28.md`.

### 신규 산출물

- `dflow-source-findings-2026-07-28.md` — D'Flow 소스 실동작 조사
- `dflow-contract-v23-delta-2026-07-28.md` — v2.1↔v2.3↔v2.4 델타 + 9건 대조(파일명 `v23`은 착수 시점 오판 흔적, 내용은 v2.4 기준)
- `team-lead-open-decisions-2026-07-28.md`(갱신) — 팀장 결정 대기 6건
- `workers/{dflow-source-contract,dflow-source-code}/brief.md`

### 남은 것 — 차단은 이제 하나뿐

> ⚠️ **이 목록은 세션 3 시점이다.** `W15`·`W16`은 세션 4에서 완료됐다(커밋 `a95c58cd`) — 최신 상태는 **Phase 5** 참조.

- ~~**`W15`·`W16`**(자동 링크) — D'Flow **R3**(연결 초기화) 의미 확정 선행~~ → **세션 4에서 완료**(Phase 5). 남은 건 코드가 아니라 **실행**(`APPLY`)이고, 그건 여전히 R3 확정이 선행돼야 한다
- **D'Flow R1 실배포** — 유일한 실질 차단. 코드·계약이 준비돼도 서버가 안 떠 있으면 재편철 실행·`include_archived` 실검증 불가
- **드리프트 리스크** — D'Flow가 정식 송부 전 브랜치를 더 고치면 소스 기준 구현이 어긋난다. 완화책: 기준 커밋 `94e5eca` 고정 + **재편철 1회차 APPLY 전** diff 재대조 의무화. 대조표 작성 후 APPLY 전, 그 구간에 **`team`이 바뀐 재전송**이 있었는지 추가로 확인한다(§4.5-11) — 있으면 그 건은 팀 루트로 되돌아가 있어 대조표가 낡은 상태이므로 재조회 후 다시 떠야 한다(버그 아님, D'Flow 의도된 동작). ⚠️ **세션 4에서 1회 대조 완료**(Phase 5, 기준 커밋 `7823391`로 갱신, 코드 영향 0건) — 재대조 의무는 그대로 유지

---

## Phase 5 — 2026-07-28 세션 4 (`W15`·`W16` 자동 링크 + 드리프트 대조 + NFC 결함 수정) — **DONE**

진행률 **17/19 → 19/19**(`+W15 +W16`). **잔여 0건 — 코드 관점에서 전 항목 완료.** 남은 것은 실행·배포·사람 결정뿐(`handoff-2026-07-27.md` §5).

### 착수 조건 확인

연결 초기화(`dflow-W10`)가 `external_id`만 null로 만들고 `folder_id`는 건드리지 않는다는 것을 D'Flow 소스·계약 §4b-1에서 확인했다 — 이게 §7.7 대상 2 판정의 전제였다.

### 완료된 W 항목

| W | 커밋 | 내용 |
|---|---|---|
| `W15`·`W16` | `a95c58cd` | `DflowAutoLinkService`(신규) + `rake dflow:autolink`/`autolink_rollback`. `#already_linked_meetings`(등급 판정 전 제외 게이트, 멱등성 보장) · `#target1_meetings`(`dflow_synced_at` 없음 AND D'Flow에 없음, `public_uid` 유무는 기준 아님) · `#target2_meetings`(초기화·삭제, `RELINK_RESET`과 무관하게 항상 계산 — claim 가능 여부만 그 플래그가 가른다) · `#each_page`(`linked=true`엔 `include_archived=true`, `linked=false` 후보 조회엔 미포함, 계약 §5.1 호출 규약) · 자동 claim 없음(dry-run 기본, `exact`만, `apply`＋`sender_names` 명시적 opt-in에서만 — 정본 §6) · `.rollback`(로컬 `public_uid`/`dflow_url` 해제만, D'Flow 쪽 초기화·본문 복구는 안 됨) |

### 검증 실측 (오케스트레이터 직접 실행)

`rspec` 전체 **2111 examples / 0 failures**(기준선 2075 + 신규 36) · `rubocop` clean. 프런트 미변경(vitest **1854** 유지, `c99a5a4b` 이후 변동 없음).

### 같은 세션에 병행된 작업 (W 항목 아님)

- **드리프트 대조**(`ae3e5915`) — D'Flow 소스 `94e5eca`→`7823391`(9커밋) 코드 레벨 전량 대조(`dflow-drift-2026-07-28.md`). API 로직 무변경, 우리 코드 영향 **0건**. 계약 사본 재동기화(`7823391` 원문, 바이트 동일) + 착수 기준 커밋 갱신
- **NFC 정규화 결함 수정**(`c99a5a4b`) — 드리프트 대조 중 발견한, 드리프트와 무관한 **ddobak 쪽 기존 결함**. 폴더명 60자 검사(`dflow_upload_service.rb#validate_folder_path_names!`)·`dflow_folder_migration_service.rb#partition_by_folder_name_length`·team 매칭(`#resolve_team!`)·프런트 `dflowAutoAssign.ts`(`#detectDflowTeam`·`#dflowRootIsResolvedTeamRoot`)가 전부 NFC 정규화 **전** 원문 기준이었다. 신규 `DflowFolderName`(`normalize`/`too_long?`/`matches?`)로 통일. `#resolve_team!` 반환값도 DB 원문(NFD 가능) 대신 `teams` 쪽 정본으로 변경 — 전송 페이로드 자체는 무변경(계약 §4.9가 D'Flow에서 NFC로 수렴한다고 명시). **프로덕션 폴더명에 NFD 실사례는 0건** — 잠재 결함이었지 실피해는 없었다
- **팀장 결정 대기 리스트 재작성**(`ae3e5915`) — 6건 → **10건**, 번호 전부 다시 매김(이전 판 번호 인용 금지). 실질 미결은 2건(회신문 전달·R1 일정)뿐, 나머지는 그 2건에 종속되거나 확인만 필요

### 남은 것 — 코드 0건, 전부 실행·배포·사람 결정

- **D'Flow R1 실배포** — 유일한 실질 차단(19개 항목 전체의 실전송 검증도 함께 막는다)
- **자동 링크 실행(`APPLY`)** — D'Flow **R3**(연결 초기화) 의미 확정 ＋ 팀장 결정 대기 항목 8(`claim` 오매칭 정책·T4 게이트) 해소가 선행돼야 한다. dry-run 자체는 R1 배포 후 코드상 바로 가능
- 상세 순서·사람 결정 목록: `handoff-2026-07-27.md` §5

---

## 진행 로그

| 시각 | 항목 | 결과 |
|---|---|---|
| 2026-07-27 13:55 | 원장 생성 | task.md · exec-state.md 작성. Phase 0 착수 |
| 2026-07-28 세션 2 | Phase 3 — `ddobak-W19`·`ddobak-W7` | **DONE** — 진행률 11/19 → 13/19. rspec 2041 pass · vitest 1840 pass. 커밋 `a9743788`(2차분, 푸시 안 함, R2 이후 배포) |
| 2026-07-28 세션 3 | Phase 4 — 소스 기준 차단 해제 + `W8`·`W12`·`W13`·`W18` + 실서버 재감사 | **DONE** — 진행률 13/19 → 17/19(잔여 `W15`·`W16`). rspec 2071 pass · vitest 1850 pass. 커밋 `bceae845`(W8)·`5eef05ee`(W12·W13)·`3efff4f8`(W18, 문서). D'Flow 미배포 실측 재확정 |
| 2026-07-28 세션 4 | Phase 5 — `W15`·`W16` 자동 링크 + 드리프트 대조 + NFC 결함 수정 | **DONE** — 진행률 17/19 → **19/19**(잔여 0). rspec 2111 pass · vitest 1854 pass(프런트 무변경). 커밋 `a95c58cd`(W15·W16)·`c99a5a4b`(NFC 수정)·`ae3e5915`(드리프트 대조·팀장 결정 리스트 재작성). 코드 전 항목 완료 — 남은 건 D'Flow R1 배포뿐 |

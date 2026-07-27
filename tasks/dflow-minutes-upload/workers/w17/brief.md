# brief — ddobak-W17 (덮어쓸 D'Flow 회의록 제목·날짜 표시)

target_repo: /Users/jji/project/ddobakddobak
write_scope: `backend/app/controllers/api/v1/meeting_dflow_controller.rb` · `backend/spec/requests/**` · `frontend/src/api/dflow.ts` · `frontend/src/components/meeting/SendToDflowDialog.tsx` · `frontend/src/components/meeting/SendToDflowDialog.test.tsx`
output_format: 변경 파일·핵심 diff 요약·검증 명령 결과

## 목적

자동 링크(4차)로 묶인 회의를 **처음 전송할 때** 사용자가 "무엇을 덮어쓰는지" 모른다. 오매칭이면 남의 회의록 본문이 통째로 덮인다(`replace`). 전송 다이얼로그가 **"D'Flow의 `<제목>`(`<날짜>`)을 덮어씁니다"** 를 보여주게 한다.

워크리스트 §4 W17 · §7.7 「오매칭의 대가」 완화 4겹 중 4번째.

## 설계 결정 — 공용 헬퍼가 아니라 `status` 액션에

워크리스트 W17 행은 `meeting_dflow_controller.rb:117`(`dflow_status_json`)을 지목하지만 **그 자리에 넣으면 안 된다**:

- `dflow_status_json`은 `upload`·`status`·`link`·`claim` **4개 액션이 공유**한다
- `list_minutes(external_id:)` 왕복은 **`status`에서만** 일어난다(`:41`)
- 공용 헬퍼에 넣으면 나머지 3개는 값이 없거나 **왕복이 3번 늘어난다**

→ **`exists_on_dflow`와 같은 자리**(`:42`, `status` 액션이 json에 직접 얹는 패턴)에 넣는다. 이미 있는 선례를 따르는 것이고 추가 왕복이 0이다.
같은 함정을 `ddobak-W19`가 §4에 이미 기록해 뒀다("공용 헬퍼에 밀어 넣으면 `status`·`link`·`claim`까지 따라붙는다").

## 작업

### 1. 백엔드
`status` 액션(`:38-45`) — 현재 `resp["items"].to_a.any?`로 존재 여부만 쓰고 응답 본문을 버린다.
그 `items` 첫 건의 `title`·`date`를 함께 실어라. D'Flow `GET /minutes`는 `title`·`date`를 응답에 포함한다.

- 키 이름은 기존 스네이크 관례를 따를 것 (예: `dflow_title`·`dflow_date`, 또는 중첩 객체)
- **존재하지 않으면(`exists_on_dflow: false`) 키를 생략하거나 null** — 프런트가 구분할 수 있게
- `public_uid`가 없으면 `list_minutes` 호출 자체를 안 하는 기존 분기 유지

### 2. 프런트 타입
`frontend/src/api/dflow.ts` — `DflowMeetingStatus`(또는 status 전용 타입)에 필드 추가. **nullable/optional**.
⚠️ `DflowUploadResult`는 upload 전용 파생 타입이다(W9). status 전용 값을 거기 넣지 말 것.

### 3. 다이얼로그 표시
`SendToDflowDialog.tsx` — 이미 연결된 회의(`public_uid` 있고 `exists_on_dflow: true`)를 전송할 때
"D'Flow의 `<제목>`(`<날짜>`)을 덮어씁니다" 취지의 안내를 띄운다.

- **기존 UI 구조 안에서 최소로.** 재설계 금지
- 기존에 `exists_on_dflow`를 쓰는 표시가 있으면(`:370-379` 부근 "존재하지 않음…") 그 옆·같은 계열로

## 검증 (TDD — 테스트 먼저)

- backend: `cd backend && bundle exec rspec spec/requests/` 중 이 컨트롤러 spec. 없으면 신설.
  ⚠️ **WebMock 없음** — `instance_double`로 `DflowClient` 스텁. 기존 spec의 HTTP 스텁 관례를 먼저 찾아 따를 것
  케이스: (a) 연결됨 + D'Flow에 존재 → title·date 실림 (b) 연결됨 + 미존재 → 키 없음/null (c) `public_uid` 없음 → `list_minutes` 미호출
- frontend: `cd frontend && npx tsc -p tsconfig.app.json` ← **전체 0이 기준. bare tsc는 거짓 green**
- frontend: `npx vitest run src/components/meeting/SendToDflowDialog.test.tsx src/api/dflow.test.ts`

## Do NOT

- `dflow_status_json` 공용 헬퍼에 필드 추가 (위 설계 결정)
- `upload` 액션 손대기 — `ddobak-W19`(2차) 소관
- 2차 이후 항목 착수 (W2·W3·W4·W5·W6·W7·W8·W12~W16·W18·W19)
- `db/migrate`에 파일 추가 (러닝 Rails dev 서버 전 요청 500)
- 러닝 dev 서버 실요청 / 실 `settings.yaml` 변경
- 커밋·푸시

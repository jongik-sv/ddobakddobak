# brief — ddobak-W2 ＋ ddobak-W6 (전송 제목 접두 폐기)

target_repo: /Users/jji/project/ddobakddobak
write_scope: `backend/app/models/meeting.rb` · `backend/spec/models/meeting_spec.rb` · `frontend/src/lib/dflowAutoAssign.ts` · `frontend/src/lib/dflowAutoAssign.test.ts` · `frontend/src/components/meeting/SendToDflowDialog.tsx`(호출부만) · 관련 프런트 테스트
output_format: 변경 파일 · 핵심 diff · 검증 명령 실제 출력 · 브리프 이탈
근거: 워크리스트 §4 `W2`·`W6` · `artifacts/ddobak-dflow-sender-spec.md` §1.4 · `decisions-final-2026-07-27.md`

## ⚠️ 배포하지 않는다 — 구현만

2차 항목이다. **D'Flow R2(플래그 `true`) 이후에만 배포**한다. 지금은 브랜치에 커밋만 쌓는다.
`main` 병합 금지. 이 사실을 코드 주석이 아니라 **최종 보고에 명시**하라.

## 배경 — 왜 접두를 없애나

지금 전송 제목은 **`<하위폴더명>-<원제목>`**(예: `물류-원재료_2026.07.15_11시00분`)이다.
`folder_path`로 폴더 계층을 직접 보내게 되면 D'Flow가 실제 폴더에 편철하므로, 제목의 접두는 **이중 라벨**이 된다(`MES/물류` 폴더 안에 `물류-…` 제목).

## W2 — 백엔드 `Meeting#dflow_auto_title`

현재: `sub = dflow_sub_folder_name` 이 있으면 `"#{sub}-#{title}"`, 200자 캡.
바꿀 것: **접두 없이 원제목**(200자 캡은 유지).

⚠️ **기존 접두 조립 로직을 지우지 말 것.** 워크리스트 §7.7 C2(자동 링크 제목 매칭)가 **접두 있는 옛 제목을 재현**해야 한다 — 연동 19건이 전부 접두 있는 제목으로 D'Flow에 올라가 있고, 접두 없는 제목으로만 비교하면 **자동 링크가 전건 0매칭**한다(정본 §7-10이 "가장 시급"으로 꼽은 지적).

→ **접두 조립을 별도 public 메서드로 보존**하고(`dflow_legacy_prefixed_title` 같은 이름), `dflow_auto_title`은 접두 없는 경로를 기본으로 한다. 이름은 네가 정하되 **용도가 드러나게** 짓고, 왜 남기는지 주석 1줄.

`dflow_sub_folder_name` 자체는 **다른 곳에서도 쓰는지 grep 확인 후** 판단 — 쓰이면 남긴다.

## W6 — 프런트 `dflowAutoAssign.ts`

`buildDflowTitle`도 같은 규칙으로. 백엔드와 **문자 단위로 같은 결과**를 내야 한다(다이얼로그 미리보기가 실제 전송값과 달라지면 안 된다).
접두 버전은 백엔드와 같은 이유로 **보존**(자동 링크 C2가 프런트에서도 필요할 수 있다).

`detectDflowTeam`은 **이번 범위 아님**(`W3` 소관) — 건드리지 말 것.

## 호출부

`SendToDflowDialog.tsx`가 `buildDflowTitle`을 쓰는 자리를 확인하고, **초기 제목값이 접두 없이** 뜨는지 확인하라. 시그니처가 바뀌면 호출부도 맞춘다.

## 검증 (TDD — 테스트 먼저)

- `cd backend && bundle exec rspec spec/models/meeting_spec.rb` — 기존 `dflow_auto_title` 케이스가 **접두를 기대하고 있을 것이다.** 삭제하지 말고 **접두 보존 메서드 쪽으로 옮겨** 유지하고, `dflow_auto_title`엔 접두 없는 새 기대값을 넣어라
- `bundle exec rspec spec/services/dflow_upload_service_spec.rb` — 서비스가 `dflow_auto_title`을 쓰므로 **여기 제목 기대값도 깨진다.** 함께 갱신
- `cd frontend && npx tsc -p tsconfig.app.json` ← **전체 0이 기준. bare tsc는 거짓 green**
- `npx vitest run src/lib/dflowAutoAssign.test.ts src/components/meeting/SendToDflowDialog.test.tsx`
- 200자 경계 케이스를 **양쪽 다** 유지하라(접두 있는 쪽/없는 쪽 캡 계산이 다르다)

## Do NOT

- `detectDflowTeam`·`resolve_team!` 손대기 (`W3` 소관, 다른 에이전트)
- `dflow_upload_service.rb` **수정** (읽기는 가능) — `W3`·`W4` 소관이라 충돌한다
- `dflow_folder_path_names`·`folder_path` 전송 로직 손대기
- `main` 병합 · 커밋 · 푸시
- `db/migrate`에 파일 추가 · 러닝 dev 서버 실요청 · 실 `settings.yaml` 변경

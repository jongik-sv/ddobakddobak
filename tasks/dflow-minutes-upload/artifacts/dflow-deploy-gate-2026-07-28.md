# D'Flow 배포 관문·스모크 환경 실동작 조사 (2026-07-28)

읽기 대상: `/Users/jji/project/wbs-web` `origin/main`(HEAD `f3d1aef`, fetch로 확인 일치) ·
`origin/feat/minutes-folder-path`(HEAD `7823391`, fetch로 확인 일치). 전부 `git show <ref>:<path>` 읽기 전용.

---

## 3줄 결론

1. **스모크 환경 확보 — 아니오.** `npm run smoke:prod`(유일한 스모크 스크립트)는 기본값이 프로덕션 Vercel URL이고, `SMOKE_URL`로 다른 URL을 가리킬 수는 있지만 그 URL이 무엇이든 Supabase는 여전히 프로덕션을 공유한다(`CLAUDE.md`: "로컬 dev 도 프로덕션 Supabase 를 공유한다"). **전용 테스트 Supabase 자체가 존재하지 않는다** — `folder-path-backlog.md` 부록이 "전용 테스트 Postgres 확보"를 스스로 **미충족 조건**으로 등재해뒀다.
2. **우리 연동 커버 — 아니오(완전 미커버).** `smoke-prod.mjs`는 `/login` HTML과 배포된 CSS 바이트 무결성만 검사한다. `POST /minutes`·`POST /minutes/folder`·`folder_path`·`include_archived` 중 어느 것도 건드리지 않는다. → **항목 2 "스모크 0건" 그대로 유지.**
3. **R1 날짜 답 — 소스에 없음.** R1은 조건(계약 v2.4+W1~W6·W24+W25 flag=false 등)으로만 정의돼 있고, 착수 시점은 "머지되면"이며 날짜는 어디에도 없다. R2는 이 두 문서에 정의 자체가 없고, R3·R4는 조건은 있으나(각각 "ddobak-W14 프로덕션 배포 확인", "재편철 1회차 완료") 날짜는 전무. **오케스트레이터의 운영 GET 프로브(아래 별도 절)가 이를 실측으로 확정** — 2026-07-28 현재 운영은 R1 미배포.

---

## Q1. `scripts/smoke-prod.mjs` — 대상 환경

**실동작**: `const BASE = (process.env.SMOKE_URL || 'https://wbs-web.vercel.app')`. 기본값은 하드코딩된 프로덕션 Vercel URL. `SMOKE_URL` 환경변수로 임의 URL로 override 가능(런북에 로컬 롤백 검증 예시: `SMOKE_URL=http://127.0.0.1:4599`). 스크립트가 하는 일은 그 BASE에 `GET /login` + CSS 정적 자산 fetch뿐 — **DB·Supabase 접근이 스크립트 안에 아예 없다.**

**근거**: `scripts/smoke-prod.mjs#main`(BASE 상수 선언부·주석 "SMOKE_URL=http://127.0.0.1:4599 npm run smoke:prod"). `CLAUDE.md`§데이터("로컬 dev 도 프로덕션 Supabase 를 공유한다").

**우리 영향**: `SMOKE_URL`을 바꿀 수 있다는 사실 자체가 "전용 테스트 Supabase 확보"를 의미하지 않는다 — 스크립트는 어느 BASE를 향하든 HTML/CSS 정적 무결성만 보고, 그 BASE 뒤 DB가 무엇인지는 아예 관심이 없다. **"운영 스모크"와 "전용 테스트 환경"은 이 리포에서 별개 개념이고, 후자는 존재가 확인되지 않는다.**

---

## Q2. 스모크가 `/minutes`·폴더 API를 건드리나 — **핵심 판정**

**실동작**: `smoke-prod.mjs`가 검사하는 항목 전부:
- `GET /login` → HTTP 200 + `id="email"`/`id="password"`/`type="submit"` 마커 존재
- HTML에서 `/_next/static/css/*.css` 링크 추출 → 각 CSS 파일 `GET` → content-length 일치·중괄호 균형(잘림 검사)
- CSS 구조 하한선: 바이트 수·규칙 수·커스텀 프로퍼티 수·`@property`·`@keyframes` 개수
- `@layer` 5종(`properties/theme/base/components/utilities`) 블록 존재
- 반응형 display 유틸(`.hidden`·`.lg\:flex`·`.sm\:flex`) 규칙 존재 + 안전망 사본 개수
- CSS 꼬리 도달 확인(`.\32 xl\:hidden`)

API 엔드포인트 호출은 **`GET /login` 하나뿐**이다. `POST /minutes`, `POST /minutes/folder`, `folder_path`, `include_archived` 어느 것도 이 스크립트에 등장하지 않는다 — 스크립트 전체가 로그인 페이지 HTML과 CSS 파일 두 종류만 fetch한다. 서버의 다른 스크립트(`scripts/apply-00xx.mjs`)들은 마이그레이션 1회성 적용·검증기이지 배포 스모크가 아니며, `npm run` 스크립트 목록(`package.json#scripts`)에도 `smoke:prod` 외 스모크류는 없다.

**근거**: `scripts/smoke-prod.mjs`(전체 — "로그인 페이지" 섹션 + "CSS 전달 무결성" 섹션 + "구조 하한선" 섹션 + "레이아웃 급소" 섹션이 코드의 전부, 그 밖의 섹션 없음). `package.json#scripts`(`smoke:prod` 정의 1건만 존재). `scripts/apply-0039.mjs`·`scripts/apply-0040.mjs`·`scripts/apply-0043.mjs`에 `minutes`/`folder_id` 문자열이 있으나 이들은 마이그레이션 적용기이고 `npm run smoke:prod`가 실행하는 대상이 아니다(별도 스크립트, package.json에 미등록).

**우리 영향**: **미커버 확정.** 스모크는 2026-07-27 CSS/레이아웃 배포 사고(사이드바 실종) 재발 방지가 유일한 목적으로 설계돼 있고(스크립트 서두 주석에 명시), 회의록·폴더 API 경로는 설계 범위 밖이다. → **"관문은 생겼지만 우리 연동은 미커버 → 우리 기준 0건 유지"** 판정이 성립한다.

---

## Q3. `.githooks/pre-push` — G1·G2가 막는 것

**실동작**:
- **G1**: 이번 push로 원격에 처음 올라가는 커밋 범위(`rev-list <local> --not --remotes=<remote>`) 안에서, **같은 커밋**이 `supabase/migrations/`와 `src/`를 동시에 건드리면 차단. 머지 커밋의 자체 변경(evil merge)도 같은 기준으로 검사. `revert` 커밋과 순수 머지(자체 변경 없음)는 예외.
- **G2**: `remote_ref`가 `refs/heads/main`일 때만 동작. 범위 안 커밋 중 UI 위험 경로(`src/app/globals.css` · `src/app/layout.tsx` · `src/app/(app)/layout.tsx` · `src/components/app/*`)를 건드렸는데 `Preview-checked:` 트레일러가 없으면 차단. "원격 어디에도 없던 커밋"만 대상이므로 브랜치로 한 번이라도 push해 Preview를 받은 커밋은 통과.
- **G3**: `tests/css/breakpoint-safety-net.test.ts`를 vitest로 실행, 실패 시 차단(vitest 없으면 건너뛰고 경고만 stderr).
- 우회: `SKIP_GUARD=1 git push`.

**근거**: `.githooks/pre-push`(G1 블록 — `UI_RE` 변수·awk 스크립트의 `mig`/`src` 플래그 판정 로직 / G2 블록 — `remote_ref = refs/heads/main` 조건·`Preview-checked` 트레일러 검사 / G3 블록 — `G3_TEST` 변수·vitest 실행부). `CLAUDE.md`§pre-push 훅 표(G1/G2/G3 요약이 코드와 일치).

**우리 영향**: **없음.** 이 훅은 `wbs-web` 리포에 push하는 사람(D'Flow 개발자)에게만 적용된다. 또박또박은 `wbs-web`에 커밋·push하지 않으므로 G1~G3 어느 것도 우리 작업 흐름에 개입하지 않는다. (참고: G1이 막는 "마이그레이션+코드 혼합 커밋"은 우리가 겪는 배포 리스크와 무관 — 우리 쪽 배포 관문이 아니다.)

---

## Q4. `docs/runbook-rollback.md` + `CLAUDE.md`(origin/main 신규) — 배포 순서·승인자

**실동작**:
- **릴리스 차수(R1~R4)나 플래그 전환 절차**: 이 두 문서 어디에도 **없음**. `runbook-rollback.md`는 전적으로 "CSS/레이아웃이 깨졌을 때" 시나리오(스테일 캐시 확인 → `npm run smoke:prod` → Vercel Instant Rollback → known-good 태그로 코드 복원 → 마이그레이션 얽힘 판단표 → `npm run mark:good`)만 다룬다. `CLAUDE.md`(origin/main)도 git 운영 규칙·pre-push 훅 설명·CSS 안전망 주의사항·데이터 원칙만 있고 R1~R4나 `MINUTES_FOLDER_PATH_ENABLED`류 플래그는 언급이 없다(그 플래그들은 `feat/minutes-folder-path` 브랜치 문서에만 존재 — Q5 참조).
- **배포 승인자·실행자**: **지정 없음.** `CLAUDE.md`는 "일반 작업은 `main` 직행으로 해도 된다"고만 하고, 배포는 `git push origin main` → Vercel 자동배포로 개인 세션 단위다. "여러 PC·여러 세션이 동시에 쓴다"는 전제만 명시될 뿐 승인자 역할(누가 push를 승인/실행하는지)은 어느 문서에도 없다.
- **`0050_migration_ledger.sql` 원장이 롤백 판정에 쓰이는 방식**: `applied_at`·`applied_by`·`checksum`(sha256)·`rollback_available`(적용 시점에 `_rollback.sql` 존재 여부를 기록, 사후 추가해도 소급 안 됨) 컬럼을 가진 append-only 감사 테이블. 되돌리려는 구간에 마이그레이션이 걸쳐 있으면 이 표를 `applied_at desc`로 조회해 각 항목의 `rollback_available`을 보고 코드 롤백 안전성을 판단한다. **2026-07-28 현재 프로덕션에 이 테이블 자체가 미적용(0행)** — 런북이 "조회해도 0행이다"라고 명시.

**근거**: `docs/runbook-rollback.md`(전체 목차 — §0~§5 + 부록, R1~R4/플래그 언급 없음을 전체 스캔으로 확인). `CLAUDE.md`(origin/main, 전체 — 배포 섹션에 승인자 언급 없음). `supabase/migrations/0050_migration_ledger.sql#migration_ledger`(테이블 정의 + "핵심 계약" 주석 5항) 및 같은 파일 주석 "앱 런타임은 이 표를 읽지 않는다. 운영 도구 전용".

**우리 영향**: 이 두 문서는 D'Flow의 CSS/레이아웃 배포 안전망이지 **우리(또박또박) 연동 기능의 배포 절차가 아니다.** "누가 R1을 받아올지"에 대한 답 후보가 여기 없다 — 승인자 개념 자체가 이 문서군에 없다.

---

## Q5. 플래그 사다리 — `docs/design/folder-path-progress.md` + `folder-path-backlog.md`(feat 브랜치)

**실동작**:

**두 플래그**:
- `MINUTES_FOLDER_PATH_ENABLED`(W25) — 기본 `false`. 꺼져 있으면 `POST /minutes`가 `folder_path` 키를 **부재와 동일하게** 취급(검증 400도 발생 안 함) → "R1 배포는 전송 동작을 1비트도 바꾸지 않는다"고 문서가 주장. 단 **감사 갭 #6**에서 이 주장이 §4.5-11(팀 변경 재전송 시 폴더 이동)에는 예외로 적용 안 됨이 정정됨(계약서·결정문서에 각각 명시 추가).
- `MINUTES_FOLDER_DND_ENABLED` — 기본 `false`, 서버 전용(`NEXT_PUBLIC_` 아님, `src/lib/minutes/flags.ts#folderDndEnabled`). `moveMinuteFolder` 서버 액션 최상단(인증보다 앞)과 `MinutesExplorer`의 드래그·드롭 UI를 게이트. **게이트 범위는 D&D 한정** — 이동 버튼 폴더 픽커(`moveMinuteToFolder`)·업로드/수정 모달 폴더 트리 선택·폴더 생성/개명/삭제는 이 플래그와 무관하게 항상 열려 있음.

**전환 순서/조건**:
- **R1** = 계약 v2.4 + W1~W6·W24 + W25(flag `false`) + 조상 규칙(§2-J) + 폴더 삭제 가드 + 배치 400 경계 + NFC. 착수 조건: **문서에 명시 없음** — "머지되면 나간다"는 취지뿐, "무엇이 되면 머지하는지"는 안 적혀 있음(§9의 "배포 안 됨 — `main` 미머지, 머지·배포는 별도 결정" 문구가 전부).
- **R4** = W18~W23 폴더 중심 UI 재편(D&D). 착수 조건: **"재편철 1회차 완료 후"**(결정 §2-A C-2 승인) — 정성적 조건, 날짜 없음. `MINUTES_FOLDER_DND_ENABLED`를 켜는 것으로 코드 재배포 없이 개방 가능하다는 점만 명시.
- **R2·R3**: `folder-path-progress.md` 본문에는 "R2"라는 라벨이 **등장하지 않는다**(§7에 "전송 전환(2차)"·"재편철(3차)"라는 표현이 있으나 이는 또박또박 자체 릴리스 차수를 가리키는 것으로 문맥상 판단되며, D'Flow의 "R" 접두 릴리스 라벨과 동일 개념인지 이 문서만으로는 확정 불가). `folder-path-backlog.md` 부록 표에 **"R3 — `clearMinuteExternalId`를 §9.4-2 원안으로 복귀"**가 등장 — 여는 조건은 **"`ddobak-W14` 프로덕션 배포 확인"**(정성적, 날짜 없음).
- **날짜**: R1·R3·R4 어디에도 캘린더 날짜가 없다. **"날짜 없음 — 조건만 있음"**이 정확한 요약이다(R2는 조건조차 이 두 문서에 없음).

**배포·스모크 관련 미결(`folder-path-backlog.md`)**:
- 부록 표 마지막 행: **"마이그레이션 테스트를 실행 기반으로" — 상태 "현재 SQL 텍스트 검사뿐" — 여는 조건 "전용 테스트 Postgres 확보"**. 이것이 항목 2("전용 테스트 Supabase 확보 여부")와 **정확히 같은 미해결 상태를 D'Flow 쪽에서도 스스로 인정**하고 있다는 근거다.
- §9 "아직 남은 것" 절: "**런타임 스모크 미실시** — 로컬 dev 서버가 프로덕션 DB를 공유하고 운영 쓰기는 금지라 `POST /minutes`(folder_path)·`POST /minutes/folder`의 실호출 검증을 하지 않았다. 단위·통합 테스트로만 덮여 있다. **전용 테스트 프로젝트 또는 스테이징에서 §14.3 E6~E10 시나리오를 돌려야 한다.**" — D'Flow 구현 담당 스스로 "우리 연동 런타임 스모크는 0건"이라고 명시적으로 적어 놓았다.
- T2(깊이 정책 3중 분기 통일)는 "R4(D&D 개방)와 맞물린다"고 명시 — R4 착수 전 처리 권고.

**근거**: `docs/design/folder-path-progress.md#8`("R1 결정 패키지" 절, W25 행) · `#9`("배포 구조" 절 — R1/R4 정의 문단·"아직 남은 것" 소절) · `#10`(감사 대응 표 #6). `docs/design/folder-path-backlog.md`(부록 표 — R3 행·"전용 테스트 Postgres 확보" 행, T2 "차단 관계" 문단).

**우리 영향**: D'Flow 구현자 본인이 "전용 테스트 프로젝트/스테이징에서 §14.3 시나리오를 돌려야 한다"·"전용 테스트 Postgres 확보"를 **미해결 선결 조건**으로 명시해뒀다는 점이, Q1·Q2의 "스모크 0건" 판정을 D'Flow 소스 자체가 뒷받침한다.

---

## 운영 실측 (오케스트레이터 제공 — 이 조사 범위 밖, 2026-07-28)

⚠️ 이 절만 이 작업(소스 read-only)이 아니라 **오케스트레이터가 별도로 수행한 GET 전용 운영 프로브**다. 이 작업 자체는 네트워크 요청을 하지 않았다(브리프 Do NOT 준수). 소스 판정(Q1·Q2·Q5)을 실측으로 보강하는 근거로만 인용한다.

- `GET /api/v1/minutes?include_archived=true&per_page=200` → HTTP 200, `total=41`, 41건 반환. 41건 전부 `archived`·`folder_id`·`folder_path` 키가 **없음**. item 키 = `created_at, created_by_name, date, external_id, id, team, title, updated_at, url`.
- `GET /api/v1/minutes/meta` → 최상위 키 `limits, projects, teams`뿐, **`folders` 키 없음**. `limits`에 폴더 깊이·폴더명 길이 상한 없음(`max_body_chars`·`max_request_bytes`·`max_attachments`·`max_attachment_bytes`뿐).
- 미지 쿼리 파라미터 내성 4종(파라미터 없음 / `include_archived=true` / 완전 미지 파라미터 / 미지+오타값) **전부 HTTP 200 `total=41`** — 구버전이 미지 파라미터를 조용히 무시(400 안 냄).

**판정**: 운영은 **R1 미배포**(계약 v2.2 이하 응답 형태) — 소스 커밋이 아니라 **응답으로 확정된 사실**이다. `folder-path-progress.md#9`의 "배포 안 됨 — `origin`에는 있으나 `main` 미머지" 서술과 정합한다. Q2와는 별개 축이지만 같은 방향을 가리킨다 — 운영에 `folder_path`·`archived` 관련 응답 필드 자체가 없으므로, 설령 스모크가 이 엔드포인트를 검사 대상에 넣었더라도 지금 시점엔 검사할 신규 필드 자체가 운영에 없다.

---

## ⚠️ 소스로 확정 못 한 것 (사람에게 물을 것)

1. **R2의 정의** — `folder-path-progress.md`·`folder-path-backlog.md`에는 D'Flow "R" 접두 릴리스 라벨로서의 R2가 등장하지 않는다. R2가 결정 정본(`dflow-decisions-final-2026-07-27.md`, 이번 브리프 범위 밖)에 정의돼 있는지, 혹은 §7의 "전송 전환(2차)"이 그것과 동일 개념인지는 이 두 문서만으로 판정 불가.
2. **`feat/minutes-folder-path`의 머지·배포 시점** — "머지·배포는 별도 결정"이라고만 적혀 있고 담당자·타임라인이 이 두 문서에 없다. "R1을 누가 받아올지"의 실제 답은 이 조사 범위(runbook-rollback.md·CLAUDE.md) 밖에 있을 가능성이 있다(별도 PMO 결정 문서나 사람 확인 필요).
3. **R2/R3/R4가 "결정 §3 배포 순서 정본"에서 날짜를 갖는지 여부** — `folder-path-progress.md#9`가 "결정 §3 배포 순서 정본은 이렇게 나눈다"고 인용하며 R1·R4만 발췌했다. 그 정본 전체(원문)를 이 조사에서 열지 않았으므로, 정본 자체에 날짜가 있는데 진행 원장이 생략했을 가능성을 배제할 수 없다.
4. **T2(깊이 정책 통일)가 R4 개방 전에 실제로 닫혔는지** — 백로그 문서는 "R4 개방 전에 닫는 것이 좋다"는 권고이지 완료 기록이 아니다. 2026-07-28 시점 상태는 조사 범위(진행 원장·백로그) 밖.

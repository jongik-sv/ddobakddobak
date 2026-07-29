# R1(코드 배포 + 플래그 off) GET 판별기 — 소스 기반

대상: `origin/feat/minutes-folder-path`(HEAD `7823391`) vs `origin/main`(HEAD `7673f90`), `wbs-web` 읽기 전용(`git show`만 사용, 네트워크 요청 없음).

## 결론 3줄

① **위 실측(0/20 folders·archived·folder_id·folder_path·folder_path_status)은 "미배포" 확정이다.** `archived` 키 추가는 플래그와 무관하게 무조건이라(아래 Q3), 배포됐다면 R1이든 R0이든 20/20에서 나왔어야 한다.
② GET 마커 **있다** — 강한 것 1개(상태코드 200 vs 400, 플래그 무관) + 보조 1개(404 body 형식 차이).
③ 제일 신뢰도 높은 명령: **`GET /api/v1/minutes?include_archived=x`** (기존에 쓰던 Bearer 그대로) → 미배포 200 / 배포(R1 포함) 400.

## Q1~Q5

| # | 질문 | 실동작 | 근거 | 판정 |
|---|------|--------|------|------|
| Q1 | 플래그 이름·기본값·읽는 위치 | `MINUTES_FOLDER_PATH_ENABLED`는 `externalApi.ts#folderPathEnabled`, `MINUTES_FOLDER_DND_ENABLED`는 `flags.ts#folderDndEnabled`. 둘 다 `process.env.X === 'true'` 요청 시점 평가(빌드 캐시 아님). 미설정 시 `undefined === 'true'` → **false(기본 off)**. | `src/lib/minutes/externalApi.ts#folderPathEnabled`, `src/lib/minutes/flags.ts#folderDndEnabled` | 확정 |
| Q2 | `/minutes/meta`의 `folders` 키가 플래그로 가려지나 | **가려지는 게 아니라 애초에 없다.** `meta/route.ts`는 main과 branch에서 **바이트 단위로 동일**(diff 0줄). 이 브랜치는 meta 응답에 `folders` 키를 추가하지 않는다. | `git diff origin/main origin/feat/minutes-folder-path -- src/app/api/v1/minutes/meta/route.ts` (빈 출력), `src/app/api/v1/minutes/meta/route.ts#GET` | 무관(항상 없음) — 이 키로는 배포 여부를 절대 못 가린다 |
| Q3 | `/minutes` item의 `archived`·`folder_id`·`folder_path`·`folder_path_status` | **`archived`만 실제로 GET list에 추가됐고, 무조건(플래그 검사 없음)이다.** `folder_id`/`folder_path`/`folder_path_status`는 GET list 응답에 **아예 없다** — 이 3개는 POST(등록/재전송) 응답(`respondMinute`)과 배치 POST 결과에만 나온다. 배치·보관노출은 주석에도 "이 플래그와 무관하게 항상 활성"이라 명시. | `src/app/api/v1/minutes/route.ts#GET`(select에 `archived_at` 추가, `archived: row.archived_at != null` 무조건 매핑), `src/lib/minutes/externalApi.ts#folderPathEnabled` 주석("배치(W6)와 보관 상태 노출(W24)은 이 플래그와 무관하게 항상 활성이다") | **`archived` 확정 판별 가능(무조건) / `folder_id`·`folder_path`·`folder_path_status`는 GET list에서 원천적으로 관측 불가(플래그 문제 아님)** |
| Q4 | 플래그 off에서도 살아있는 배포 마커 | 아래 프로브 표 참조. `POST /minutes/folder`(신규 라우트)는 GET을 아예 안 받고 `export const GET = apiNotFound`로 하드코딩 — gate·플래그 확인 자체를 안 거친다. `GET /minutes`의 `include_archived` 파라미터 검증도 무조건. | `src/app/api/v1/minutes/folder/route.ts`(파일 끝 `export const GET = apiNotFound`), `src/app/api/v1/minutes/route.ts#GET`(`includeArchivedRaw` 검증 블록) | 확정 — 두 마커 모두 플래그 무관 |
| Q5 | GET만으로 판별 불가한가 | 아니다 — Q4에 마커 있음 | — | 해당 없음 |

## 실행 가능한 프로브 표

| # | GET 경로+파라미터 | 미배포(main) 예상 | R1(배포+플래그 off) 예상 | 판별력 |
|---|---|---|---|---|
| 1 | `GET /api/v1/minutes?include_archived=x`(기존 Bearer) | **200**, `include_archived`는 무시되는 미지 파라미터라 정상 목록 그대로(main은 이 파라미터를 아예 안 읽음) | **400** `{"error":"include_archived는 true 또는 false여야 합니다.","code":"validation_failed"}` | **강** — 상태코드 자체가 갈림, `MINUTES_FOLDER_PATH_ENABLED`/`MINUTES_FOLDER_DND_ENABLED` 둘 다와 무관, `gateMinutesApi`(이미 통과 확인됨)만 통과하면 끝 |
| 2 | `GET /api/v1/minutes/folder`(인증 헤더 불필요 — 이 라우트 GET은 gate조차 안 거침) | Next.js App Router 기본 404 처리 — `src/app/not-found.tsx` 렌더 → **HTML**(`Content-Type: text/html`, "404" 카드 UI 포함) | 라우트 파일이 존재하므로 `export const GET = apiNotFound` 실행 → **JSON** `{"error":"Not Found"}`(`Content-Type: application/json`), 상태 코드는 둘 다 404라 **status만 보면 구분 안 됨 — body/Content-Type을 봐야 함** | 중(인프라 가정 포함, 아래 ⚠️ 참조) |
| 3 | `GET /api/v1/minutes?limit=1`(기존과 동일, 이미 확보된 데이터 재해석) | item에 `archived` 키 없음 | item에 `archived` 키 **무조건** 존재(boolean) | 강(이미 실측 데이터로 판정 가능 — 새 요청 불필요, 0/20 = 미배포 쪽 근거) |

**우선순위**: #1을 1차로 실행(상태코드만 보면 되고 인프라 가정이 전혀 없음) → 결과가 200이면 이미 #3과 일치해 미배포 쪽으로 수렴, 400이 나오면 배포됐다는 뜻이므로 #2로 교차검증.

## ⚠️ 소스로 확정 못한 것

- **프로브 #2의 "미배포 시 HTML 404" 가정**은 Next.js App Router의 표준 동작(`not-found.tsx` 존재, `middleware.ts#middleware`의 matcher가 `api`를 명시적으로 제외해 미들웨어가 개입하지 않음)에 근거한 추론이다. Vercel의 서버리스 라우팅 레이어가 완전히 매칭되지 않는 `/api/*` 경로를 Next 앱에 진입시키기 전에 자체 404로 가로챌 가능성은 소스로는 확인할 수 없다(운영 인프라 설정 영역). 그래서 결론에서 #1을 1순위로 뒀다 — #1은 이 가정이 전혀 필요 없다.
- `MINUTES_API_ENABLED`·`MINUTES_API_SECRET`가 운영에 실제로 켜져 있다는 것은 이번 소스 조사로는 확인 불가 — 다만 사용자가 이미 GET `/minutes/meta`·`/minutes`에서 200을 받았다는 실측 자체가 `gateMinutesApi`(`src/lib/minutes/externalApi.ts#gateMinutesApi`) 통과의 증거이므로, 프로브 #1·#2도 같은 전제(이미 충족됨) 위에서 유효하다.
- `MINUTES_FOLDER_PATH_ENABLED`/`MINUTES_FOLDER_DND_ENABLED`가 운영에서 지금 어떤 값인지는 소스로 알 수 없다(env는 코드 밖). Q1의 "미설정 시 기본 false"만 소스로 확정된다.

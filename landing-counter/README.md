# landing-counter

`https://jongik-sv.github.io/ddobakddobak/landing/` 방문 수를 집계하는 작은 Vercel Functions 프로젝트.
Upstash Redis에 `landing:total`(누적)과 `landing:d:<YYYY-MM-DD>`(일별, Asia/Seoul 기준)를 `INCR`한다.
통계는 소유자만 `x-stats-key` 헤더로 확인할 수 있다.

> **검증 범위**: 지금까지 확인된 것은 `npx tsc --noEmit` 타입 체크 통과뿐이다. 실제 배포 환경에서
> `Redis.fromEnv()`가 올바른 환경변수를 읽는지, CORS·요청 제한·인증이 실제로 동작하는지는
> 아직 실행해 확인한 적이 없다. 아래 "배포 후 확인" 절의 curl 예시로 배포 직후 반드시 직접 확인한다.

## 엔드포인트

- `POST /api/hit` — 방문 1건 집계. 랜딩 페이지가 로드 시 호출. IP당 분당 30회 제한, 초과·오류 시에도 조용히 `204`.
- `GET /api/stats` — 누적/오늘/최근 30일 통계. `x-stats-key` 헤더가 `STATS_KEY`와 일치해야 하며, 불일치·미설정 시 `404`.

두 엔드포인트 모두 CORS 허용 오리진은 `https://jongik-sv.github.io` 하나뿐이다.

## 배포 절차 (사용자가 직접 실행)

1. Vercel CLI 전역 설치
   ```bash
   npm install -g vercel
   ```
2. 로그인
   ```bash
   vercel login
   ```
3. `landing-counter/` 디렉토리에서 프로젝트 연결
   ```bash
   cd landing-counter
   vercel link
   ```
4. Upstash Redis 통합 추가
   ```bash
   vercel integration add upstash
   ```
5. **환경변수 이름 확인** — `api/hit.ts`와 `api/stats.ts` 각각의 `getRedis()`는 URL·토큰 각각 표준
   이름을 먼저 보고, 없으면 아래 대체 이름으로 넘어가도록 이미 구현되어 있다.
   - URL: `UPSTASH_REDIS_REST_URL` → 없으면 `KV_REST_API_URL`
   - 토큰: `UPSTASH_REDIS_REST_TOKEN` → 없으면 `KV_REST_API_TOKEN`

   실측 결과, `yoo7032-4504s-projects/ddobak-landing-counter` 프로젝트에서 `vercel integration add
   upstash`(현재는 `upstash-kv`)를 실행하면 `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`은
   주입되지 **않고**, 대신 `REDIS_URL`·`KV_URL`·`KV_REST_API_URL`·`KV_REST_API_TOKEN`·
   `KV_REST_API_READ_ONLY_TOKEN` 다섯 개가 Production·Preview·Development 세 환경 모두에 주입되었다.
   위 코드의 대체 이름(`KV_REST_API_URL`/`KV_REST_API_TOKEN`)이 정확히 이 이름들과 맞아떨어지므로
   추가 조치 없이 그대로 동작한다. (`KV_REST_API_READ_ONLY_TOKEN`은 `INCR`을 할 수 없는 읽기 전용
   토큰이라 코드에서 쓰지 않는다.)

   다만 다른 계정이나 다른 시기에 연동하면 이름이 또 달라질 수 있으므로, 아래로 실제 주입된 이름을
   한 번은 확인한다.
   ```bash
   vercel env ls
   ```
   위 두 쌍(표준 이름 또는 `KV_REST_API_*`) 어느 쪽도 존재하지 않으면, `api/hit.ts`와 `api/stats.ts`
   **양쪽 모두**의 `resolveEnv(...)` 호출에 실제 주입된 이름을 대체 인자로 추가해야 한다. 이 확인을
   건너뛰고 어느 이름도 채워지지 않으면 `getRedis()`가 예외를 던지는데, `hit.ts`는 Redis 오류를 전부
   삼키고 `204`를 반환하도록 설계되어 있어서(방문자 화면에 영향을 주지 않기 위함) 방문자에게는 아무
   이상이 없어 보이고 `/api/stats`의 `total`·`today`만 계속 `0`으로 남는다. 원인은 Vercel 함수 로그에서
   `[landing-counter] Redis 환경변수 누락: ...` 메시지로 확인할 수 있다.

   > **주의**: 이 프로젝트에서는 `api/` 안의 파일 하나하나가 Vercel에서 독립된 함수로 개별
   > 번들·배포된다. `_`로 시작하는 파일을 만들어 별도 함수 배포 대상에서 빼더라도, 그 파일이 다른
   > 함수의 번들에 자동으로 합쳐지지는 않는다(실제로 `api/_redis.ts` 공용 모듈을 시도했다가
   > `Cannot find module '/var/task/api/_redis'`로 두 엔드포인트가 전부 500이 난 적이 있다). 따라서
   > `getRedis()` 같은 공통 로직은 공용 모듈로 분리하지 말고, 각 함수 파일 안에 그대로 중복해서 둔다.
6. `STATS_KEY` 환경변수 등록 — 충분히 긴 난수 문자열을 Production에 등록한다(예: `openssl rand -hex 32`로 생성).
   ```bash
   vercel env add STATS_KEY
   ```
7. **Deployment Protection 확인** — 이 Vercel 프로젝트에 Deployment Protection(Vercel Authentication 등)이
   모든 배포에 걸려 있으면, GitHub Pages가 보내는 `POST /api/hit` 요청이 함수 대신 로그인 페이지를 받게 되어
   역시 오류 없이 조용히 실패한다(브라우저의 `fetch`는 오리진이 달라 리다이렉트 응답을 CORS 오류로만 보고
   삼키므로 방문자에게도 드러나지 않는다). Vercel 프로젝트 설정의 Deployment Protection에서 이 프로젝트의
   보호를 끄거나, 최소한 Production 배포에는 적용되지 않도록(프리뷰 배포에만 적용) 확인한다.
8. 프로덕션 배포
   ```bash
   vercel --prod
   ```
9. 배포로 확정된 도메인(예: `https://landing-counter-xxxx.vercel.app`)을 랜딩 HTML의 `COUNTER_ORIGIN` 상수에 적어 넣는다.
   **반드시 Vercel 배포를 먼저 끝내고, 그 도메인을 랜딩에 반영한 뒤에 랜딩(`docs/landing/index.html`)을 push해야 한다.** 순서가 바뀌면 랜딩이 존재하지 않는 도메인을 호출하게 된다.

## 배포 후 확인 (curl 예시)

`<DEPLOY_ORIGIN>`은 8번에서 확정된 도메인, `<STATS_KEY>`는 6번에서 등록한 값으로 치환한다.

```bash
# 방문 집계 (정상 오리진)
curl -i -X POST https://<DEPLOY_ORIGIN>/api/hit \
  -H "Origin: https://jongik-sv.github.io"
# → 204

# 허용되지 않은 오리진
curl -i -X POST https://<DEPLOY_ORIGIN>/api/hit \
  -H "Origin: https://evil.example"
# → 403

# 통계 조회 (키 없음 → 존재 자체를 숨기기 위해 404)
curl -i https://<DEPLOY_ORIGIN>/api/stats \
  -H "Origin: https://jongik-sv.github.io"
# → 404

# 통계 조회 (정상 키)
curl -i https://<DEPLOY_ORIGIN>/api/stats \
  -H "Origin: https://jongik-sv.github.io" \
  -H "x-stats-key: <STATS_KEY>"
# → 200, { "total": ..., "today": ..., "days": [...] }
```

## 로컬 개발

```bash
npm install
npx tsc --noEmit   # 타입 체크만 (배포 없이)
vercel dev         # 로컬에서 함수 실행 (Upstash 연동은 vercel env pull 필요)
```

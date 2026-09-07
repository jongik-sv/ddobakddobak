import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// Node.js 런타임 필요: Redis/Ratelimit 클라이언트가 Node 환경을 전제로 함.
export const config = {
  runtime: 'nodejs',
};

const ALLOWED_ORIGIN = 'https://jongik-sv.github.io';

// api/ 안의 각 파일은 Vercel에서 독립된 함수로 개별 번들·배포된다. `_` 접두사 파일도
// 다른 함수의 번들에 합쳐지지 않고 그냥 배포에서 빠지므로, 공용 모듈로 분리하면 안 되고
// 이 함수가 필요한 코드는 이 파일 안에 그대로 둬야 한다 (hit.ts/stats.ts 중복 허용).

// 표준 이름을 먼저 보고, 없으면 이번 계정에 실측된 Upstash Marketplace 연동 이름으로 넘어간다.
// KV_REST_API_READ_ONLY_TOKEN은 INCR을 할 수 없으므로 절대 쓰지 않는다.
function resolveEnv(primaryName: string, fallbackName: string): string | undefined {
  return process.env[primaryName] ?? process.env[fallbackName];
}

// 모듈 최상위에서 즉시 생성하면 환경변수가 없는 빌드 시점에 크래시하므로 지연 생성한다.
let redisClient: Redis | undefined;
function getRedis(): Redis {
  if (!redisClient) {
    const url = resolveEnv('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL');
    const token = resolveEnv('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN');

    const missing: string[] = [];
    if (!url) missing.push('UPSTASH_REDIS_REST_URL 또는 KV_REST_API_URL');
    if (!token) missing.push('UPSTASH_REDIS_REST_TOKEN 또는 KV_REST_API_TOKEN');
    if (missing.length > 0 || !url || !token) {
      throw new Error(`[landing-counter] Redis 환경변수 누락: ${missing.join(', ')}`);
    }

    redisClient = new Redis({ url, token });
  }
  return redisClient;
}

let ratelimitClient: Ratelimit | undefined;
function getRatelimit(): Ratelimit {
  if (!ratelimitClient) {
    ratelimitClient = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(30, '1 m'),
      analytics: false,
      prefix: 'landing:ratelimit',
    });
  }
  return ratelimitClient;
}

// Asia/Seoul 기준 YYYY-MM-DD.
function seoulDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
}

// Node.js 런타임의 요청 헤더는 소문자로 정규화되어 들어오고, 값이 string | string[] | undefined다.
// 배열로 오는 경우(예: 같은 헤더가 여러 번 온 경우) 첫 값만 취한다.
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// 허용 오리진일 때만 CORS 헤더를 실어 보내고, true/false로 허용 여부를 알린다.
function applyCorsHeaders(res: VercelResponse, origin: string | undefined, extra: Record<string, string>): boolean {
  if (origin !== ALLOWED_ORIGIN) {
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  for (const [key, value] of Object.entries(extra)) {
    res.setHeader(key, value);
  }
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const method = req.method ?? 'GET';

  if (method !== 'POST' && method !== 'OPTIONS') {
    res.status(405).end();
    return;
  }

  const origin = firstHeaderValue(req.headers.origin);
  const corsOk = applyCorsHeaders(res, origin, {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  });

  if (!corsOk) {
    res.status(403).end();
    return;
  }

  if (method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for']);
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';

  try {
    const { success } = await getRatelimit().limit(ip);
    if (!success) {
      // 한도 초과: 카운트를 올리지 않고 조용히 204만 반환한다.
      res.status(204).end();
      return;
    }

    const today = seoulDateString(new Date());
    const pipeline = getRedis().pipeline();
    pipeline.incr('landing:total');
    pipeline.incr(`landing:d:${today}`);
    await pipeline.exec();
  } catch (error) {
    // Redis 오류가 방문자 화면에 영향을 주면 안 되므로 삼키고 로그만 남긴다.
    console.error('[landing-counter] hit failed', error);
  }

  res.status(204).end();
}

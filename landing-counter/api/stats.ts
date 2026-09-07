import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { timingSafeEqual } from 'node:crypto';

// Node.js 런타임 필요: node:crypto의 timingSafeEqual을 사용.
export const config = {
  runtime: 'nodejs',
};

const ALLOWED_ORIGIN = 'https://jongik-sv.github.io';
const DAYS_TO_RETURN = 30;

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

// 길이가 다르면 즉시 불일치 처리하고, 같을 때만 timingSafeEqual로 비교한다.
function isAuthorized(req: VercelRequest): boolean {
  const expected = process.env.STATS_KEY;
  if (!expected) {
    return false;
  }
  const provided = firstHeaderValue(req.headers['x-stats-key']);
  if (!provided) {
    return false;
  }
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const method = req.method ?? 'GET';

  if (method !== 'GET' && method !== 'OPTIONS') {
    res.status(405).end();
    return;
  }

  const origin = firstHeaderValue(req.headers.origin);
  const corsOk = applyCorsHeaders(res, origin, {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'x-stats-key',
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

  // 엔드포인트 존재 자체를 숨기기 위해 401이 아닌 404로 응답한다.
  if (!isAuthorized(req)) {
    res.status(404).end();
    return;
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    const now = new Date();
    const dates: string[] = [];
    for (let i = DAYS_TO_RETURN - 1; i >= 0; i -= 1) {
      dates.push(seoulDateString(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
    }
    const dayKeys = dates.map((date) => `landing:d:${date}`);

    const client = getRedis();
    const [totalRaw, countsRaw] = await Promise.all([
      client.get<number>('landing:total'),
      client.mget<number[]>(...dayKeys),
    ]);

    const total = Number(totalRaw ?? 0) || 0;
    const counts = countsRaw ?? [];
    const days = dates.map((date, index) => ({
      date,
      count: Number(counts[index] ?? 0) || 0,
    }));
    const today = days[days.length - 1]?.count ?? 0;

    res.status(200).json({ total, today, days });
  } catch (error) {
    console.error('[landing-counter] stats failed', error);
    res.status(500).end();
  }
}

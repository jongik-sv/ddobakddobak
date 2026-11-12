import { WhiteboardValidationError } from './schema'

export type WhiteboardFailureKind = 'auth' | 'rate_limit' | 'format' | 'timeout' | 'not_found' | 'unknown'

export interface WhiteboardFailure {
  kind: WhiteboardFailureKind
  message: string
}

export const WHITEBOARD_FAILURE_MESSAGES = {
  auth: '이 PC의 Claude Code에 로그인되어 있지 않습니다. 터미널에서 `claude`를 한 번 실행해 로그인해 주세요.',
  rate_limit: 'Claude 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
  format: 'Claude 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.',
  timeout: '3분 안에 응답이 없어 중단했습니다. 다시 시도해 주세요.',
  not_found: '이 PC에서 Claude Code를 찾을 수 없습니다.',
} as const

const AUTH_RE = /login|not logged in|authenticat|\/login|\b401\b|oauth/i
const RATE_RE = /rate limit|usage limit|limit reached|\b429\b|quota/i

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Tauri invoke reject 값(WhiteboardRunError), Error, 문자열 어느 쪽이든 분류한다.
 * 재요청 후에도 검증에 실패한 경우는 WhiteboardValidationError 를 넘기거나 { format: true } 로 알린다.
 */
export function classifyWhiteboardFailure(err: unknown, opts: { format?: boolean } = {}): WhiteboardFailure {
  if (opts.format || err instanceof WhiteboardValidationError) {
    return { kind: 'format', message: WHITEBOARD_FAILURE_MESSAGES.format }
  }
  let kind = ''
  let message = ''
  let haystack = ''
  if (typeof err === 'string') {
    message = err
    haystack = err
  } else if (err instanceof Error) {
    message = err.message
    haystack = err.message
  } else if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    kind = str(o.kind)
    message = str(o.message)
    haystack = [message, str(o.stderr_tail), str(o.stdout_tail)].join('\n')
  }
  if (kind === 'timeout') return { kind: 'timeout', message: WHITEBOARD_FAILURE_MESSAGES.timeout }
  if (kind === 'not_found') return { kind: 'not_found', message: WHITEBOARD_FAILURE_MESSAGES.not_found }
  if (AUTH_RE.test(haystack)) return { kind: 'auth', message: WHITEBOARD_FAILURE_MESSAGES.auth }
  if (RATE_RE.test(haystack)) return { kind: 'rate_limit', message: WHITEBOARD_FAILURE_MESSAGES.rate_limit }
  const summary = (message || haystack).replace(/\s+/g, ' ').trim().slice(0, 120)
  return { kind: 'unknown', message: `화이트보드를 만들지 못했습니다: ${summary || '알 수 없는 오류'}` }
}

/**
 * 정상 종료(exit 0)한 stdout 이 JSON 이 아닐 때, 로그인 필요·한도 문구인지 본다.
 * 맞으면 해당 kind 실패를, 아니면 null 을 돌려준다(재요청 낭비를 막기 위함).
 * 긴 응답은 정상 보드 본문일 수 있으므로 짧은 출력만 본다.
 */
export function classifyWhiteboardOutput(text: string): WhiteboardFailure | null {
  const t = String(text ?? '')
  if (t.length > 1000) return null
  if (AUTH_RE.test(t)) return { kind: 'auth', message: WHITEBOARD_FAILURE_MESSAGES.auth }
  if (RATE_RE.test(t)) return { kind: 'rate_limit', message: WHITEBOARD_FAILURE_MESSAGES.rate_limit }
  return null
}

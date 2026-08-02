import { HTTPError } from 'ky'

interface ApiErrorBody {
  error?: string
  errors?: string[]
  /** 백엔드 에러 식별 코드 (예: recorder_conflict) */
  code?: string
}

/**
 * 다양한 에러 타입에서 사용자 표시용 메시지를 뽑아낸다.
 * - ky HTTPError: 응답 본문의 `error` 또는 `errors`(쉼표 결합)
 * - Error: `message`
 * - 그 외: fallback
 */
export async function errorToMessage(err: unknown, fallback: string): Promise<string> {
  if (err instanceof HTTPError) {
    const body = (await err.response.json().catch(() => ({}))) as ApiErrorBody
    return body.error ?? body.errors?.join(', ') ?? fallback
  }
  if (err instanceof Error && err.message) {
    return err.message
  }
  return fallback
}

/**
 * ky HTTPError에서 HTTP status + 백엔드 코드/메시지를 추출한다. HTTPError가 아니면 null.
 * 주의: response body는 1회만 읽을 수 있으므로 같은 에러에 errorToMessage와 중복 호출하지 말 것.
 */
export async function httpErrorInfo(
  err: unknown,
): Promise<{ status: number; code: string | null; message: string | null } | null> {
  if (!(err instanceof HTTPError)) return null
  const body = (await err.response.json().catch(() => ({}))) as ApiErrorBody
  return { status: err.response.status, code: body.code ?? null, message: body.error ?? null }
}

/**
 * 서버가 MeetingWriteGuard#reject_if_redacted! 로 내려주는 영구 거부(409, code="meeting_redacted")
 * 인지 판정한다. 이 회의는 기밀 구간 절단이 적용되어 bulk_create·오디오 create/chunk/finalize 를
 * 다시는 받지 않는다 — status(409)만으론 재시도 가능한 다른 409(잠금·레코더 충돌 등)와 구분할
 * 수 없어 code 로만 판정한다.
 *
 * 두 가지 에러 모양을 모두 처리한다:
 * - ky HTTPError(apiClient 경유, 예: bulkCreateTranscripts) — httpErrorInfo 로 본문을 읽는다.
 * - raw fetch 헬퍼(uploadAudioChunk 등)가 res.ok 체크 후 부착해 던지는 에러 — response body 는
 *   1회만 읽을 수 있어 Response 자체를 들고 있을 수 없으므로, 파싱한 code 를 `.code` 로 부착해
 *   던진다는 계약이다.
 */
export async function isMeetingRedactedError(err: unknown): Promise<boolean> {
  if (err instanceof HTTPError) {
    const info = await httpErrorInfo(err)
    return info?.code === 'meeting_redacted'
  }
  const code = (err as { code?: unknown } | null | undefined)?.code
  return code === 'meeting_redacted'
}

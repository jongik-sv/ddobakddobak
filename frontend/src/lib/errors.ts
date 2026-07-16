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

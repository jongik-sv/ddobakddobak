import { HTTPError } from 'ky'

interface ApiErrorBody {
  error?: string
  errors?: string[]
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

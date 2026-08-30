import apiClient from './client'
import { downloadWithDisposition } from './projectTransfers'

/** PAT(개인 액세스 토큰) 스코프 5종. */
export type ApiTokenScope =
  | 'meetings:read'
  | 'transcripts:read'
  | 'summaries:read'
  | 'search:read'
  | 'meetings:write'

export const API_TOKEN_SCOPES: ApiTokenScope[] = [
  'meetings:read',
  'transcripts:read',
  'summaries:read',
  'search:read',
  'meetings:write',
]

export interface ApiToken {
  id: number
  name: string
  token_prefix: string
  scopes: ApiTokenScope[]
  project_ids: number[] | null
  folder_ids: number[] | null
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
}

export interface ApiTokenCreateParams {
  name: string
  scopes: ApiTokenScope[]
  expires_at: string
  project_ids?: number[]
  folder_ids?: number[]
}

export interface ApiTokenCreateResult {
  token: ApiToken
  /** 평문 토큰(ddbk_...). 이 응답에서만 내려오며 이후 다시 조회할 수 없다. */
  plaintext: string
}

export async function listApiTokens(): Promise<ApiToken[]> {
  const res = await apiClient.get('api_tokens').json<{ tokens: ApiToken[] }>()
  return res.tokens
}

export async function createApiToken(params: ApiTokenCreateParams): Promise<ApiTokenCreateResult> {
  return apiClient.post('api_tokens', { json: params }).json<ApiTokenCreateResult>()
}

/** 토큰 폐기(revoke). 목록에서 삭제되지 않고 revoked_at이 채워진 채로 남는다. */
export async function deleteApiToken(id: number): Promise<void> {
  await apiClient.delete(`api_tokens/${id}`)
}

/** Claude Code 등 LLM 에이전트용 스킬 패키지(zip)를 내려받는다. */
export async function downloadSkillPackage(): Promise<void> {
  const response = await apiClient.get('skill_package')
  await downloadWithDisposition(response, 'ddobak-skill-package.zip')
}

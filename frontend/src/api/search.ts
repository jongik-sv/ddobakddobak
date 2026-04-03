import apiClient from './client'

export interface SearchResult {
  meeting_id: number
  meeting_title: string
  type: 'transcript' | 'summary'
  snippet: string
  speaker: string | null
  created_at: string
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  page: number
  per_page: number
}

export interface SearchParams {
  q: string
  speaker?: string
  date_from?: string
  date_to?: string
  folder_id?: number
  status?: string
  page?: number
  per_page?: number
}

export async function searchMeetings(params: SearchParams): Promise<SearchResponse> {
  const searchParams: Record<string, string | number> = {}
  if (params.q) searchParams.q = params.q
  if (params.speaker) searchParams.speaker = params.speaker
  if (params.date_from) searchParams.date_from = params.date_from
  if (params.date_to) searchParams.date_to = params.date_to
  if (params.folder_id) searchParams.folder_id = params.folder_id
  if (params.status) searchParams.status = params.status
  if (params.page) searchParams.page = params.page
  if (params.per_page) searchParams.per_page = params.per_page
  return apiClient.get('search', { searchParams }).json()
}

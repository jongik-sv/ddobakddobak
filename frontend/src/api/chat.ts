import apiClient from './client'

export type ChatRole = 'user' | 'assistant'
export type ChatStatus = 'pending' | 'complete' | 'error'

export interface ChatMessage {
  id: number
  role: ChatRole
  content: string
  status: ChatStatus
  /** 어시스턴트 답변 뒤 예상질문(한국어, 최대 3개). 클릭 시 즉시 자동 질문. */
  suggestions?: string[]
  error_message?: string | null
  created_at: string
}

/** 현재 사용자의 이 회의 대화 내역(시간순)을 가져온다. GET /api/v1/meetings/:id/chat_messages */
export async function getChatMessages(meetingId: number): Promise<ChatMessage[]> {
  return apiClient.get(`meetings/${meetingId}/chat_messages`).json()
}

/**
 * 질문을 보낸다. 서버가 user 메시지 + pending assistant 메시지를 만들고
 * MeetingChatJob을 enqueue한 뒤 두 메시지를 반환한다.
 * POST /api/v1/meetings/:id/chat_messages
 */
export async function sendChatMessage(
  meetingId: number,
  content: string,
): Promise<{ user_message: ChatMessage; assistant_message: ChatMessage }> {
  return apiClient.post(`meetings/${meetingId}/chat_messages`, { json: { content } }).json()
}

export type ChatScopeType = 'meeting' | 'folder' | 'project'

function scopePath(scopeType: ChatScopeType, scopeId: number): string {
  if (scopeType === 'folder') return `folders/${scopeId}/chat_messages`
  if (scopeType === 'project') return `projects/${scopeId}/chat_messages`
  return `meetings/${scopeId}/chat_messages`
}

export async function getScopedChatMessages(scopeType: ChatScopeType, scopeId: number): Promise<ChatMessage[]> {
  return apiClient.get(scopePath(scopeType, scopeId)).json()
}

export async function sendScopedChatMessage(
  scopeType: ChatScopeType, scopeId: number, content: string,
): Promise<{ user_message: ChatMessage; assistant_message: ChatMessage }> {
  return apiClient.post(scopePath(scopeType, scopeId), { json: { content } }).json()
}

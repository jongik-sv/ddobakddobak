import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import { useChatStore } from '../stores/chatStore'
import type { ChatMessage, ChatScopeType } from '../api/chat'

/**
 * ChatChannel - per-user, scope AI 챗 실시간 채널.
 * MeetingChatJob이 assistant 메시지를 갱신하면 `chat_message_update`로 broadcast한다.
 * transcription.ts와 동일한 consumer 생성·인증 규약(createAuthenticatedConsumer)을 따른다.
 * meeting scope는 레거시 호환 { meeting_id }로 전송, folder/project는 { scope_type, scope_id }.
 */
type ChatMessageUpdate = { type: string } & ChatMessage

export function subscribeChat(scopeType: ChatScopeType, scopeId: number): () => void {
  const consumer = createAuthenticatedConsumer()
  const channelParams =
    scopeType === 'meeting'
      ? { channel: 'ChatChannel', meeting_id: scopeId }
      : { channel: 'ChatChannel', scope_type: scopeType, scope_id: scopeId }
  const sub = consumer.subscriptions.create(channelParams, {
    received(data: ChatMessageUpdate) {
      console.debug('[chat] update', data.id, data.status)
      if (data.type === 'chat_message_update') {
        useChatStore.getState().applyUpdate(data)
      }
    },
  })
  return () => {
    sub.unsubscribe()
    consumer.disconnect()
  }
}

import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import { useChatStore } from '../stores/chatStore'
import type { ChatMessage } from '../api/chat'

/**
 * ChatChannel - per-user,meeting AI 챗 실시간 채널.
 * MeetingChatJob이 assistant 메시지를 갱신하면 `chat_message_update`로 broadcast한다.
 * transcription.ts와 동일한 consumer 생성·인증 규약(createAuthenticatedConsumer)을 따른다.
 */
type ChatMessageUpdate = { type: string } & ChatMessage

export function subscribeChat(meetingId: number): () => void {
  const consumer = createAuthenticatedConsumer()
  const sub = consumer.subscriptions.create(
    { channel: 'ChatChannel', meeting_id: meetingId },
    {
      received(data: ChatMessageUpdate) {
        if (data.type === 'chat_message_update') {
          useChatStore.getState().applyUpdate(data)
        }
      },
    },
  )
  return () => {
    sub.unsubscribe()
    consumer.disconnect()
  }
}

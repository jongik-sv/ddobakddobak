import { useEffect } from 'react'
import { Users } from 'lucide-react'
import { useContacts } from '../../hooks/useContacts'
import { createAuthenticatedConsumer } from '../../lib/actionCableAuth'
import { ContactCard } from './ContactCard'

interface ContactsSectionProps {
  meetingId: number
}

export function ContactsSection({ meetingId }: ContactsSectionProps) {
  const { contacts, remove, refetch } = useContacts(meetingId)

  // 명함 인식은 비동기(서버 Job) — 전용 채널 구독으로 contacts_updated 수신 시 refetch.
  // useTranscription 마운트 여부와 무관하게 동작하도록 독립 구독한다.
  useEffect(() => {
    const consumer = createAuthenticatedConsumer()
    const sub = consumer.subscriptions.create(
      { channel: 'TranscriptionChannel', meeting_id: meetingId },
      {
        received(data: { type?: string }) {
          if (data?.type === 'contacts_updated' || data?.type === 'card_extraction_failed') {
            refetch()
          }
        },
      },
    )
    return () => {
      sub.unsubscribe()
      consumer.disconnect()
    }
  }, [meetingId, refetch])

  if (contacts.length === 0) return null

  return (
    <div className="border-b bg-gray-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2 text-sm font-medium text-gray-700">
        <Users className="w-4 h-4" />
        참석자 (명함)
        <span className="text-xs text-gray-400">{contacts.length}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {contacts.map((c) => (
          <ContactCard key={c.id} contact={c} onDelete={remove} />
        ))}
      </div>
    </div>
  )
}

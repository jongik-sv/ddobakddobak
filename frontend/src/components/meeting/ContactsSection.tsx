import { useEffect, useState } from 'react'
import { Users, AlertTriangle } from 'lucide-react'
import { useContacts } from '../../hooks/useContacts'
import { createAuthenticatedConsumer } from '../../lib/actionCableAuth'
import { ContactCard } from './ContactCard'

interface ContactsSectionProps {
  meetingId: number
}

export function ContactsSection({ meetingId }: ContactsSectionProps) {
  const { contacts, remove, update, refetch } = useContacts(meetingId)
  const [failed, setFailed] = useState(false)

  // 명함 인식은 서버 비동기 Job. 전용 채널 구독으로 결과를 반영한다(독립 구독 → 다른 페이지 상태와 무관).
  useEffect(() => {
    const consumer = createAuthenticatedConsumer()
    const sub = consumer.subscriptions.create(
      { channel: 'TranscriptionChannel', meeting_id: meetingId },
      {
        received(data: { type?: string }) {
          if (data?.type === 'contacts_updated') {
            setFailed(false)
            refetch()
          } else if (data?.type === 'card_extraction_failed') {
            setFailed(true)
          }
        },
      },
    )
    return () => {
      sub.unsubscribe()
      consumer.disconnect()
    }
  }, [meetingId, refetch])

  if (contacts.length === 0 && !failed) return null

  return (
    <div className="border-b bg-gray-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2 text-sm font-medium text-gray-700">
        <Users className="w-4 h-4" />
        참석자 (명함)
        {contacts.length > 0 && <span className="text-xs text-gray-400">{contacts.length}</span>}
      </div>

      {failed && (
        <div className="mb-2 flex items-center gap-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          명함 인식에 실패했어요. 원본 이미지는 첨부에 남아 있습니다.
          <button type="button" onClick={() => setFailed(false)} className="ml-auto text-amber-500 hover:text-amber-700">
            닫기
          </button>
        </div>
      )}

      {contacts.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {contacts.map((c) => (
            <ContactCard key={c.id} contact={c} onDelete={remove} onUpdate={update} />
          ))}
        </div>
      )}
    </div>
  )
}

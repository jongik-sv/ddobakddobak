import { useState } from 'react'
import { Mail, Phone, Smartphone, Building2, Trash2 } from 'lucide-react'
import type { MeetingContact } from '../../api/contacts'

interface ContactCardProps {
  contact: MeetingContact
  onDelete: (id: number) => void
}

export function ContactCard({ contact, onDelete }: ContactCardProps) {
  const [showRaw, setShowRaw] = useState(false)
  const subtitle = [contact.company, contact.department, contact.title].filter(Boolean).join(' · ')
  const extraEntries = Object.entries(contact.extra ?? {})

  return (
    <div className="w-56 shrink-0 rounded-lg border bg-white p-3 hover:shadow-sm hover:border-blue-300 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 truncate">{contact.name || '(미인식 명함)'}</p>
          {subtitle && <p className="text-xs text-gray-500 truncate flex items-center gap-1"><Building2 className="w-3 h-3 shrink-0" />{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => onDelete(contact.id)}
          className="text-gray-300 hover:text-red-500 shrink-0"
          aria-label="삭제"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-2 space-y-1 text-xs text-gray-600">
        {contact.mobile && <p className="flex items-center gap-1 truncate"><Smartphone className="w-3 h-3 shrink-0" />{contact.mobile}</p>}
        {contact.phone && <p className="flex items-center gap-1 truncate"><Phone className="w-3 h-3 shrink-0" />{contact.phone}</p>}
        {contact.email && <p className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" />{contact.email}</p>}
      </div>

      {(extraEntries.length > 0 || contact.raw_text) && (
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          aria-expanded={showRaw}
          className="mt-2 text-[11px] text-blue-500 hover:underline"
        >
          {showRaw ? '접기' : '자세히'}
        </button>
      )}
      {showRaw && (
        <div className="mt-1 space-y-1 text-[11px] text-gray-500">
          {extraEntries.map(([k, v]) => (
            <p key={k} className="truncate"><span className="text-gray-400">{k}:</span> {String(v)}</p>
          ))}
          {contact.raw_text && <pre className="whitespace-pre-wrap break-words">{contact.raw_text}</pre>}
        </div>
      )}
    </div>
  )
}

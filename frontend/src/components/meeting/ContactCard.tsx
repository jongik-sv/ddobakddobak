import { useState } from 'react'
import { Mail, Phone, Smartphone, Building2, Trash2, Pencil, Check, X } from 'lucide-react'
import type { MeetingContact, UpdateContactParams } from '../../api/contacts'

interface ContactCardProps {
  contact: MeetingContact
  onDelete: (id: number) => void
  onUpdate: (id: number, data: UpdateContactParams) => void
  /** 잠긴 회의면 수정·삭제 버튼을 숨긴다. 기본 false. */
  readOnly?: boolean
}

const EDIT_FIELDS: { key: keyof UpdateContactParams; label: string }[] = [
  { key: 'name', label: '이름' },
  { key: 'company', label: '회사' },
  { key: 'department', label: '부서' },
  { key: 'title', label: '직함' },
  { key: 'mobile', label: '휴대폰' },
  { key: 'phone', label: '전화' },
  { key: 'email', label: '이메일' },
]

export function ContactCard({ contact, onDelete, onUpdate, readOnly = false }: ContactCardProps) {
  const [showRaw, setShowRaw] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<UpdateContactParams>({})

  const startEdit = () => {
    setForm({
      name: contact.name, company: contact.company, department: contact.department,
      title: contact.title, mobile: contact.mobile, phone: contact.phone, email: contact.email,
    })
    setEditing(true)
  }
  const save = () => { onUpdate(contact.id, form); setEditing(false) }

  if (editing) {
    return (
      <div className="w-56 shrink-0 rounded-lg border border-blue-300 bg-white p-3">
        <div className="space-y-1">
          {EDIT_FIELDS.map((f) => (
            <input
              key={f.key}
              value={(form[f.key] as string) ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder={f.label}
              aria-label={f.label}
              className="w-full rounded border px-2 py-1 text-xs"
            />
          ))}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600" aria-label="취소">
            <X className="w-4 h-4" />
          </button>
          <button type="button" onClick={save} className="text-blue-500 hover:text-blue-700" aria-label="저장">
            <Check className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  const subtitle = [contact.company, contact.department, contact.title].filter(Boolean).join(' · ')
  const extraEntries = Object.entries(contact.extra ?? {})

  return (
    <div className="w-56 shrink-0 rounded-lg border bg-white p-3 hover:shadow-sm hover:border-blue-300 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 truncate">{contact.name || '(미인식 명함)'}</p>
          {subtitle && <p className="text-xs text-gray-500 truncate flex items-center gap-1"><Building2 className="w-3 h-3 shrink-0" />{subtitle}</p>}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={startEdit} className="text-gray-300 hover:text-blue-500" aria-label="수정">
              <Pencil className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => onDelete(contact.id)} className="text-gray-300 hover:text-red-500" aria-label="삭제">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1 text-xs text-gray-600">
        {contact.mobile && <p className="flex items-center gap-1 truncate"><Smartphone className="w-3 h-3 shrink-0" />{contact.mobile}</p>}
        {contact.phone && <p className="flex items-center gap-1 truncate"><Phone className="w-3 h-3 shrink-0" />{contact.phone}</p>}
        {contact.email && <p className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" />{contact.email}</p>}
      </div>

      {(extraEntries.length > 0 || contact.raw_text) && (
        <button type="button" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw} className="mt-2 text-[11px] text-blue-500 hover:underline">
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

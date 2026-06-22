import { useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { IconType } from '../../api/projects'

export interface IconValue {
  icon_type: IconType | null
  icon_value: string | null
  color: string | null
}

interface IconPickerProps {
  value: IconValue
  onChange: (value: IconValue) => void
}

const LUCIDE_NAMES = [
  'home', 'rocket', 'megaphone', 'users', 'calendar', 'star',
  'folder', 'flask-conical', 'wrench', 'pen-tool', 'settings', 'sprout',
]
const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9', '#64748b']
const EMOJIS = ['🚀', '📣', '🎯', '💡', '🏢', '📊', '🔬', '🛠️', '📝', '🎨', '⚙️', '🌱']

function toPascal(value: string): string {
  return value.replace(/(^\w|-\w)/g, (s) => s.replace('-', '').toUpperCase())
}

type Tab = 'lucide' | 'emoji' | 'image'

const TABS: { key: Tab; label: string }[] = [
  { key: 'lucide', label: '아이콘' },
  { key: 'emoji', label: '이모지' },
  { key: 'image', label: '업로드' },
]

export default function IconPicker({ value, onChange }: IconPickerProps) {
  const [tab, setTab] = useState<Tab>(value.icon_type ?? 'lucide')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const color = value.color ?? COLORS[0]

  // 이미지 파일을 data URL로 읽어 아이콘으로 설정(버튼 선택·드래그 공용).
  const readImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      onChange({ icon_type: 'image', icon_value: String(reader.result), color })
    }
    reader.readAsDataURL(file)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) readImageFile(file)
  }

  // 픽커 어디에 떨궈도 이미지면 설정 + 업로드 탭으로 전환. preventDefault로 브라우저 파일 이동 차단.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      readImageFile(file)
      setTab('image')
    }
  }
  const handleDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
      setDragOver(true)
    }
  }
  const handleDragLeave = (e: React.DragEvent) => {
    // 자식으로 들어갈 때의 leave는 무시 — 픽커 밖으로 나갈 때만 해제
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`rounded-md border p-3 transition-colors ${
        dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-zinc-200'
      }`}
    >
      <div className="mb-3 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1 text-sm transition-colors ${
              tab === t.key ? 'bg-indigo-600 text-white' : 'text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'lucide' && (
        <div>
          <div className="grid grid-cols-6 gap-2">
            {LUCIDE_NAMES.map((name) => {
              const key = toPascal(name) as keyof typeof Icons
              const Cmp = (Icons[key] as LucideIcon | undefined) ?? Icons.Folder
              const selected = value.icon_type === 'lucide' && value.icon_value === name
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onChange({ icon_type: 'lucide', icon_value: name, color })}
                  className={`flex h-10 items-center justify-center rounded-md border transition-colors ${
                    selected ? 'border-indigo-600 ring-2 ring-indigo-500' : 'border-zinc-200 hover:bg-zinc-100'
                  }`}
                  aria-label={name}
                >
                  <Cmp className="h-5 w-5" style={{ color }} />
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ ...value, color: c, icon_type: value.icon_type ?? 'lucide' })}
                className={`h-7 w-7 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-zinc-400' : ''}`}
                style={{ backgroundColor: c }}
                aria-label={`색상 ${c}`}
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'emoji' && (
        <div className="grid grid-cols-6 gap-2">
          {EMOJIS.map((emoji) => {
            const selected = value.icon_type === 'emoji' && value.icon_value === emoji
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onChange({ icon_type: 'emoji', icon_value: emoji, color })}
                className={`flex h-10 items-center justify-center rounded-md border text-xl transition-colors ${
                  selected ? 'border-indigo-600 ring-2 ring-indigo-500' : 'border-zinc-200 hover:bg-zinc-100'
                }`}
              >
                {emoji}
              </button>
            )
          })}
        </div>
      )}

      {tab === 'image' && (
        <div className="flex flex-col items-center gap-3">
          {value.icon_type === 'image' && value.icon_value ? (
            <img
              src={value.icon_value}
              alt="미리보기"
              className="h-16 w-16 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-zinc-200 text-xs text-zinc-500">
              미리보기
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            이미지 선택
          </button>
          <p className="text-center text-xs text-zinc-500">
            이미지를 끌어다 놓거나 선택하세요. 저장 시 함께 보관됩니다.
          </p>
        </div>
      )}
    </div>
  )
}

import { useState, useMemo } from 'react'
import { Plus, Link, Upload } from 'lucide-react'
import { useAttachments } from '../../hooks/useAttachments'
import { AttachmentCard } from './AttachmentCard'
import { AddFileDialog } from './AddFileDialog'
import { AddLinkDialog } from './AddLinkDialog'
import type { AttachmentCategory } from '../../api/attachments'

interface AttachmentSectionProps {
  meetingId: number
}

const CATEGORIES: { value: AttachmentCategory; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'reference', label: '참고자료' },
  { value: 'minutes', label: '첨부' },
]

export function AttachmentSection({ meetingId }: AttachmentSectionProps) {
  const { attachments, remove, refetch } = useAttachments(meetingId)
  const [activeCategory, setActiveCategory] = useState<AttachmentCategory>('agenda')
  const [showFileDialog, setShowFileDialog] = useState(false)
  const [showLinkDialog, setShowLinkDialog] = useState(false)

  const countByCategory = useMemo(() => {
    const counts: Record<AttachmentCategory, number> = { agenda: 0, reference: 0, minutes: 0 }
    for (const a of attachments) {
      if (a.category in counts) counts[a.category]++
    }
    return counts
  }, [attachments])

  const filtered = useMemo(
    () => attachments.filter((a) => a.category === activeCategory),
    [attachments, activeCategory],
  )

  return (
    <div className="px-6 py-3 border-b bg-gray-50/50 shrink-0">
      {/* 상단: 카테고리 탭 + 액션 버튼 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeCategory === cat.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {cat.label}({countByCategory[cat.value]})
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowFileDialog(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            파일 추가
          </button>
          <button
            onClick={() => setShowLinkDialog(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
          >
            <Link className="w-3.5 h-3.5" />
            링크 추가
          </button>
        </div>
      </div>

      {/* 카드 리스트 */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">첨부된 항목이 없습니다</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {filtered.map((a) => (
            <AttachmentCard
              key={a.id}
              attachment={a}
              meetingId={meetingId}
              onDelete={remove}
            />
          ))}
        </div>
      )}

      {/* 파일 추가 다이얼로그 */}
      {showFileDialog && (
        <AddFileDialog
          meetingId={meetingId}
          defaultCategory={activeCategory}
          onClose={() => setShowFileDialog(false)}
          onUploaded={refetch}
        />
      )}

      {/* 링크 추가 다이얼로그 */}
      {showLinkDialog && (
        <AddLinkDialog
          meetingId={meetingId}
          defaultCategory={activeCategory}
          onClose={() => setShowLinkDialog(false)}
          onAdded={refetch}
        />
      )}
    </div>
  )
}

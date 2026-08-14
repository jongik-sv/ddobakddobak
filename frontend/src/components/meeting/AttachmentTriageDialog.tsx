import { useEffect, useRef, useState } from 'react'
import { createFileAttachment } from '../../api/attachments'
import type { AttachmentCategory } from '../../api/attachments'
import { errorToMessage } from '../../lib/errors'
import { formatSize } from '../../lib/formatBytes'
import { suggestAttachmentCategory } from '../../lib/fileTriage'
import { Dialog } from '../ui/Dialog'

const CATEGORIES: { value: AttachmentCategory; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'reference', label: '참고자료' },
  { value: 'stakeholder', label: '이해관계자' },
  { value: 'business_card', label: '명함' },
]

// 소규모 동시 업로드 제한 (일괄 대량 드롭 시 서버 과부하 방지)
const CONCURRENCY = 3

interface AttachmentTriageDialogProps {
  open: boolean
  meetingId: number
  files: File[]
  onClose: () => void
  onUploaded?: () => void
}

interface TriageItem {
  id: number
  file: File
  category: AttachmentCategory
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

export function AttachmentTriageDialog({ open, meetingId, files, onClose, onUploaded }: AttachmentTriageDialogProps) {
  // 인덱스 대신 안정적인 id로 항목을 추적한다 — 업로드 도중 목록이 변하면(제거·추가) 인덱스가
  // 시프트되어 엉뚱한 행에 상태를 기록하는 문제(findings #2)를 막는다.
  const idCounterRef = useRef(0)
  const makeItem = (file: File): TriageItem => {
    idCounterRef.current += 1
    return { id: idCounterRef.current, file, category: suggestAttachmentCategory(file), status: 'pending' as const }
  }

  const [items, setItems] = useState<TriageItem[]>(() => files.map(makeItem))

  // items의 "지금 값"을 항상 동기적으로 들고 있는 거울 — React state는 커밋 타이밍이 비동기라
  // await 직후 최신값을 보장할 수 없다. runUploads 완료 직후 allDone을 정확히 판단하려면
  // (findings #3: 업로드 도중 추가된 항목까지 포함해야 함) 이 ref를 단일 진실 소스로 쓴다.
  const itemsRef = useRef<TriageItem[]>(items)
  const updateItems = (updater: (prev: TriageItem[]) => TriageItem[]) => {
    const next = updater(itemsRef.current)
    itemsRef.current = next
    setItems(next)
  }

  // 병합(append) dedup은 현재 items(prev)가 아니라 "이번 세션에서 이미 본 적 있는 파일"
  // 집합을 기준으로 해야 한다 — items 기준이면 로컬 제거로 items에서 빠진 순간 그 파일이
  // 다시 "모르는 파일"이 되어, 다음 드롭 병합 때 부활해버린다(findings #4 후속 버그).
  const seenFilesRef = useRef<Set<File>>(new Set(files))

  const [uploading, setUploading] = useState(false)

  // MeetingPage가 다이얼로그를 마운트 상태로 유지하며 open/files만 바꾸는 경우를 대비한다.
  // files는 병합(append) 시맨틱이다(findings #4) — 이미 본 파일(참조 동일)은 건드리지 않고
  // (업로드 상태 보존, 로컬 제거도 유지), 처음 보는 파일만 추가한다. files가 빈 배열로
  // 바뀌면(세션 종료 신호, MeetingPage가 닫힘 시 초기화) 목록과 seen 집합을 모두 비운다.
  useEffect(() => {
    if (files.length === 0) {
      seenFilesRef.current = new Set()
      updateItems((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const added = files.filter((f) => !seenFilesRef.current.has(f))
    if (added.length === 0) return
    for (const f of added) seenFilesRef.current.add(f)
    updateItems((prev) => [...prev, ...added.map(makeItem)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  if (!open) return null

  const removeItem = (id: number) => {
    updateItems((prev) => prev.filter((it) => it.id !== id))
  }

  const changeCategory = (id: number, category: AttachmentCategory) => {
    updateItems((prev) => prev.map((it) => (it.id === id ? { ...it, category } : it)))
  }

  // id별로 순차 진행하되 최대 CONCURRENCY개까지 동시에 진행한다.
  const runUploads = async (targets: { id: number; item: TriageItem }[]) => {
    setUploading(true)
    try {
      let cursor = 0
      const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
        while (cursor < targets.length) {
          const { id, item } = targets[cursor]
          cursor += 1
          await uploadSingle(id, item)
        }
      })
      await Promise.all(workers)
    } finally {
      setUploading(false)
    }
  }

  const uploadSingle = async (id: number, item: TriageItem) => {
    updateItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'uploading', error: undefined } : it)))
    try {
      await createFileAttachment(meetingId, item.category, item.file)
      updateItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'done' } : it)))
    } catch (err: unknown) {
      const msg = await errorToMessage(err, '업로드 실패')
      updateItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'error', error: msg } : it)))
    }
  }

  // 업데이터(setItems 내부)는 순수하게 유지하고, 완료 판정·콜백 호출은 항상 밖에서
  // itemsRef의 최신 스냅샷으로 수행한다(findings #3).
  const finalizeIfAllDone = () => {
    const current = itemsRef.current
    const allDone = current.length > 0 && current.every((it) => it.status === 'done')
    if (allDone) {
      onUploaded?.()
      onClose()
    }
  }

  const handleUpload = async () => {
    const targets = itemsRef.current
      .filter((it) => it.status === 'pending' || it.status === 'error')
      .map((item) => ({ id: item.id, item }))
    if (targets.length === 0) return
    await runUploads(targets)
    finalizeIfAllDone()
  }

  const handleRetry = async (id: number) => {
    const item = itemsRef.current.find((it) => it.id === id)
    if (!item) return
    await runUploads([{ id, item }])
    finalizeIfAllDone()
  }

  return (
    <Dialog onClose={onClose} ariaLabel="첨부파일 분류">
      <h2 className="text-lg font-semibold mb-4">첨부파일 분류</h2>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-4">분류할 파일이 없습니다.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto space-y-2 mb-4">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <p className="truncate text-foreground">{item.file.name}</p>
                <p className="text-xs text-muted-foreground">{formatSize(item.file.size)}</p>
              </div>
              <select
                aria-label={`${item.file.name} 카테고리`}
                value={item.category}
                onChange={(e) => changeCategory(item.id, e.target.value as AttachmentCategory)}
                disabled={item.status === 'uploading' || item.status === 'done'}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs shrink-0"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              {item.status === 'uploading' && <span className="text-xs text-muted-foreground shrink-0">업로드중…</span>}
              {item.status === 'done' && <span className="text-green-500 text-xs shrink-0">완료</span>}
              {item.status === 'error' && (
                <span className="flex items-center gap-1 shrink-0">
                  <span className="text-red-500 text-xs" title={item.error}>실패</span>
                  <button
                    type="button"
                    onClick={() => handleRetry(item.id)}
                    disabled={uploading}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    재시도
                  </button>
                </span>
              )}
              {item.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={uploading}
                  className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-50"
                  aria-label={`${item.file.name} 제거`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          닫기
        </button>
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || items.length === 0 || items.every((it) => it.status === 'done')}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {uploading ? '업로드 중...' : `업로드 (${items.length})`}
        </button>
      </div>
    </Dialog>
  )
}

import { useState, useEffect, useCallback } from 'react'
import {
  getGlossary, createMeetingGlossaryEntry, createFolderGlossaryEntry,
  updateGlossaryEntry, deleteGlossaryEntry, reapplyGlossary,
} from '../api/glossary'
import type { GlossaryView, GlossaryEntryInput } from '../api/glossary'

export function useGlossary(meetingId: number) {
  const [view, setView] = useState<GlossaryView | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setView(await getGlossary(meetingId))
    } finally {
      setLoading(false)
    }
  }, [meetingId])

  useEffect(() => { load() }, [load])

  const addMeetingEntry = useCallback(async (data: GlossaryEntryInput) => {
    await createMeetingGlossaryEntry(meetingId, data)
    await load()
  }, [meetingId, load])

  const addFolderEntry = useCallback(async (folderId: number, data: GlossaryEntryInput) => {
    await createFolderGlossaryEntry(folderId, data)
    await load()
  }, [load])

  const editEntry = useCallback(async (id: number, data: Partial<GlossaryEntryInput>) => {
    await updateGlossaryEntry(id, data)
    await load()
  }, [load])

  const removeEntry = useCallback(async (id: number) => {
    await deleteGlossaryEntry(id)
    await load()
  }, [load])

  const reapply = useCallback(async () => {
    setStatus('재적용 중...')
    try {
      const r = await reapplyGlossary(meetingId)
      setStatus(`완료 (트랜스크립트 ${r.corrected_transcripts}건 수정)`)
      await load()
      setTimeout(() => setStatus(''), 3000)
    } catch {
      setStatus('재적용 실패')
      setTimeout(() => setStatus(''), 3000)
    }
  }, [meetingId, load])

  return { view, loading, status, reload: load, addMeetingEntry, addFolderEntry, editEntry, removeEntry, reapply }
}

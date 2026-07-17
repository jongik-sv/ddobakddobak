import { useState, useEffect, useCallback } from 'react'
import {
  listDomainFiles, getMeetingDomainFiles, setMeetingDomainFiles,
  createDomainFile, uploadDomainFile, updateDomainFile, deleteDomainFile,
  mergeDomainTerms, extractDomainTerms,
} from '../api/domainFiles'
import type { DomainFile, DomainFileDetail, ExtractedTerm } from '../api/domainFiles'

/** 회의에 연결된 도메인 파일(용어집) 선택·조회·CRUD·용어 추출/병합 훅 (GlossaryPanel 패턴) */
export function useDomainFiles(meetingId: number, projectId: number | null) {
  const [selected, setSelected] = useState<Pick<DomainFile, 'id' | 'name' | 'project_id'>[]>([])
  const [available, setAvailable] = useState<DomainFile[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sel, avail] = await Promise.all([
        getMeetingDomainFiles(meetingId),
        listDomainFiles(projectId ?? undefined),
      ])
      setSelected(sel.domain_files)
      setAvailable(avail.domain_files)
    } finally {
      setLoading(false)
    }
  }, [meetingId, projectId])

  useEffect(() => { load() }, [load])

  const select = useCallback(async (ids: number[]) => {
    const res = await setMeetingDomainFiles(meetingId, ids)
    setSelected(res.domain_files)
  }, [meetingId])

  const createFile = useCallback(async (data: { name: string; content: string; project_id?: number | null }) => {
    const res = await createDomainFile(data)
    await load()
    return res.domain_file
  }, [load])

  const uploadFile = useCallback(async (file: File, o?: { name?: string; project_id?: number | null }) => {
    const res = await uploadDomainFile(file, o)
    await load()
    return res.domain_file
  }, [load])

  const saveFile = useCallback(async (id: number, data: { name?: string; content?: string }): Promise<DomainFileDetail> => {
    const res = await updateDomainFile(id, data)
    await load()
    return res.domain_file
  }, [load])

  const removeFile = useCallback(async (id: number) => {
    await deleteDomainFile(id)
    await load()
  }, [load])

  const extract = useCallback(async (): Promise<ExtractedTerm[]> => {
    setStatus('추출 중...')
    try {
      const res = await extractDomainTerms(meetingId)
      setStatus('')
      return res.terms
    } catch (e) {
      setStatus('')
      throw e
    }
  }, [meetingId])

  const merge = useCallback(async (id: number, terms: ExtractedTerm[]) => {
    const res = await mergeDomainTerms(id, terms)
    await load()
    return res
  }, [load])

  return { selected, available, loading, status, reload: load, select, createFile, uploadFile, saveFile, removeFile, extract, merge }
}

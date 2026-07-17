import { useState, useEffect, useCallback } from 'react'
import {
  listDomainFiles,
  getMeetingDomainFiles, setMeetingDomainFiles,
  getFolderDomainFiles, setFolderDomainFiles,
  getProjectDomainFiles, setProjectDomainFiles,
  createDomainFile, uploadDomainFile, updateDomainFile, deleteDomainFile,
  mergeDomainTerms, extractDomainTerms,
} from '../api/domainFiles'
import type {
  DomainFile, DomainFileDetail, DomainFileSummary, InheritedDomainFile, ExtractedTerm,
} from '../api/domainFiles'

export type DomainFileOwnerType = 'meeting' | 'folder' | 'project'

/**
 * 도메인 파일(용어집) 선택·조회·CRUD·용어 추출/병합 훅.
 * owner 파라미터화: meeting/folder/project 3레벨 모두 지원. meeting만 inherited(상속분)와
 * 요약에서 용어 추출(extract)을 갖는다 — folder/project는 자기 링크만 다룬다.
 */
export function useDomainFiles(ownerType: DomainFileOwnerType, ownerId: number, projectId: number | null) {
  const [selected, setSelected] = useState<DomainFileSummary[]>([])
  const [inherited, setInherited] = useState<InheritedDomainFile[]>([])
  /** 회의 전용: 상속분 중 이 회의에서 제외(exclude)된 파일 */
  const [excluded, setExcluded] = useState<DomainFileSummary[]>([])
  const [available, setAvailable] = useState<DomainFile[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (ownerType === 'meeting') {
        const [sel, avail] = await Promise.all([
          getMeetingDomainFiles(ownerId),
          listDomainFiles(projectId ?? undefined),
        ])
        setSelected(sel.selected)
        setInherited(sel.inherited)
        setExcluded(sel.excluded)
        setAvailable(avail.domain_files)
      } else if (ownerType === 'folder') {
        const [sel, avail] = await Promise.all([
          getFolderDomainFiles(ownerId),
          listDomainFiles(projectId ?? undefined),
        ])
        setSelected(sel.domain_files)
        setInherited(sel.inherited)
        setExcluded([])
        setAvailable(avail.domain_files)
      } else {
        const [sel, avail] = await Promise.all([
          getProjectDomainFiles(ownerId),
          listDomainFiles(projectId ?? undefined),
        ])
        setSelected(sel.domain_files)
        setInherited([])
        setExcluded([])
        setAvailable(avail.domain_files)
      }
    } finally {
      setLoading(false)
    }
  }, [ownerType, ownerId, projectId])

  useEffect(() => { load() }, [load])

  const select = useCallback(async (ids: number[]) => {
    if (ownerType === 'meeting') {
      const res = await setMeetingDomainFiles(ownerId, ids)
      setSelected(res.selected)
      setInherited(res.inherited)
      setExcluded(res.excluded)
    } else if (ownerType === 'folder') {
      const res = await setFolderDomainFiles(ownerId, ids)
      setSelected(res.domain_files)
    } else {
      const res = await setProjectDomainFiles(ownerId, ids)
      setSelected(res.domain_files)
    }
  }, [ownerType, ownerId])

  /** 상속된(폴더/프로젝트) 파일을 이 회의에서만 제외 — meeting 전용 */
  const excludeInherited = useCallback(async (fileId: number) => {
    if (ownerType !== 'meeting') throw new Error('회의에서만 사용할 수 있습니다')
    const nextExcludedIds = Array.from(new Set([...excluded.map((f) => f.id), fileId]))
    const res = await setMeetingDomainFiles(ownerId, selected.map((f) => f.id), nextExcludedIds)
    setSelected(res.selected)
    setInherited(res.inherited)
    setExcluded(res.excluded)
  }, [ownerType, ownerId, selected, excluded])

  /** 제외했던 상속 파일을 복원 — meeting 전용 */
  const restoreInherited = useCallback(async (fileId: number) => {
    if (ownerType !== 'meeting') throw new Error('회의에서만 사용할 수 있습니다')
    const nextExcludedIds = excluded.filter((f) => f.id !== fileId).map((f) => f.id)
    const res = await setMeetingDomainFiles(ownerId, selected.map((f) => f.id), nextExcludedIds)
    setSelected(res.selected)
    setInherited(res.inherited)
    setExcluded(res.excluded)
  }, [ownerType, ownerId, selected, excluded])

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
    if (ownerType !== 'meeting') throw new Error('회의에서만 사용할 수 있습니다')
    setStatus('추출 중...')
    try {
      const res = await extractDomainTerms(ownerId)
      setStatus('')
      return res.terms
    } catch (e) {
      setStatus('')
      throw e
    }
  }, [ownerType, ownerId])

  const merge = useCallback(async (id: number, terms: ExtractedTerm[]) => {
    const res = await mergeDomainTerms(id, terms)
    await load()
    return res
  }, [load])

  return {
    selected, inherited, excluded, available, loading, status,
    reload: load, select, excludeInherited, restoreInherited, createFile, uploadFile, saveFile, removeFile, extract, merge,
  }
}

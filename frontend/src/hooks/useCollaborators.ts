import { useState, useEffect, useCallback } from 'react'
import { getMeetingCollaborators, addMeetingCollaborator, removeMeetingCollaborator } from '../api/meetings'
import type { Collaborator, InheritedCollaborator } from '../api/meetings/collaborators'
import { getFolderCollaborators, addFolderCollaborator, removeFolderCollaborator } from '../api/folders'
import { getProjectMembers } from '../api/projects'
import type { ProjectMember } from '../api/projects'

export type CollaboratorOwnerType = 'meeting' | 'folder'

/**
 * 협업자(직접 지정 + 폴더 상속) 조회·추가·제거 훅 — 회의/폴더 공용(useDomainFiles와 동일 골격).
 * 프로젝트 멤버 목록을 훅이 직접 들고 있어 CollaboratorsPanel은 순수 프레젠테이션에 가깝게 유지된다.
 */
export function useCollaborators(ownerType: CollaboratorOwnerType, ownerId: number, projectId: number | null) {
  const [direct, setDirect] = useState<Collaborator[]>([])
  const [inherited, setInherited] = useState<InheritedCollaborator[]>([])
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [res, members] = await Promise.all([
        ownerType === 'meeting' ? getMeetingCollaborators(ownerId) : getFolderCollaborators(ownerId),
        projectId != null ? getProjectMembers(projectId) : Promise.resolve([]),
      ])
      setDirect(res.direct)
      setInherited(res.inherited)
      setProjectMembers(members)
    } catch {
      setError('협업자 목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [ownerType, ownerId, projectId])

  useEffect(() => { load() }, [load])

  const add = useCallback(async (userId: number) => {
    if (ownerType === 'meeting') {
      await addMeetingCollaborator(ownerId, userId)
    } else {
      await addFolderCollaborator(ownerId, userId)
    }
    await load()
  }, [ownerType, ownerId, load])

  const remove = useCallback(async (userId: number) => {
    if (ownerType === 'meeting') {
      await removeMeetingCollaborator(ownerId, userId)
    } else {
      await removeFolderCollaborator(ownerId, userId)
    }
    await load()
  }, [ownerType, ownerId, load])

  return { direct, inherited, projectMembers, loading, error, add, remove, reload: load }
}

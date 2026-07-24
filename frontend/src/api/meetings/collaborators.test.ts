import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getMeetingCollaborators, addMeetingCollaborator, removeMeetingCollaborator } from './collaborators'

const { mockJson, mockGet, mockPost, mockDelete } = vi.hoisted(() => {
  const mockJson = vi.fn()
  const mockGet = vi.fn(() => ({ json: mockJson }))
  const mockPost = vi.fn(() => ({ json: mockJson }))
  const mockDelete = vi.fn(() => Promise.resolve())
  return { mockJson, mockGet, mockPost, mockDelete }
})

vi.mock('../client', () => ({
  default: { get: mockGet, post: mockPost, delete: mockDelete },
}))

describe('meeting collaborators API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue({ json: mockJson })
    mockPost.mockReturnValue({ json: mockJson })
  })

  describe('getMeetingCollaborators', () => {
    it('meetings/:id/collaborators 엔드포인트로 GET 요청', async () => {
      mockJson.mockResolvedValue({ direct: [], inherited: [] })
      await getMeetingCollaborators(1)
      expect(mockGet).toHaveBeenCalledWith('meetings/1/collaborators')
    })

    it('direct/inherited 목록을 그대로 반환', async () => {
      const direct = [{ user_id: 2, name: '김철수', email: 'kim@x.com' }]
      const inherited = [{ user_id: 3, name: '박영희', email: 'park@x.com', folder_id: 9, folder_name: '기획팀' }]
      mockJson.mockResolvedValue({ direct, inherited })
      const result = await getMeetingCollaborators(1)
      expect(result.direct).toEqual(direct)
      expect(result.inherited).toEqual(inherited)
    })
  })

  describe('addMeetingCollaborator', () => {
    it('meetings/:id/collaborators 엔드포인트로 POST 요청, user_id를 json body로 전달', async () => {
      mockJson.mockResolvedValue({ collaborator: { user_id: 2, name: '김철수', email: 'kim@x.com' } })
      await addMeetingCollaborator(1, 2)
      expect(mockPost).toHaveBeenCalledWith('meetings/1/collaborators', { json: { user_id: 2 } })
    })

    it('생성된 collaborator를 반환', async () => {
      const collaborator = { user_id: 2, name: '김철수', email: 'kim@x.com' }
      mockJson.mockResolvedValue({ collaborator })
      const result = await addMeetingCollaborator(1, 2)
      expect(result).toEqual(collaborator)
    })
  })

  describe('removeMeetingCollaborator', () => {
    it('meetings/:id/collaborators/:user_id 엔드포인트로 DELETE 요청', async () => {
      await removeMeetingCollaborator(1, 2)
      expect(mockDelete).toHaveBeenCalledWith('meetings/1/collaborators/2')
    })
  })
})

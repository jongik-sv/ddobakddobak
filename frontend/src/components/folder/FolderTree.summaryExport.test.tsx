import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { FolderNode } from '../../api/folders'

// ── api/transfers ── exportFolderSummaries 호출 여부·인자를 검증하기 위한 스파이.
const exportFolderSummaries = vi.fn()
vi.mock('../../api/transfers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../api/transfers')>()
  return {
    ...mod,
    exportFolderSummaries: (...a: unknown[]) => exportFolderSummaries(...a),
  }
})

// FolderTree가 여는 하위 다이얼로그는 ExportButton.test.tsx 관례처럼 스텁 처리
// (본 테스트에서는 열리지 않지만 브리프 관례를 유지).
vi.mock('./ExportFolderDialog', () => ({ default: () => null }))

// ── folderStore ── 실제 스토어는 fetchFolders()에서 네트워크(getFolderTree)를 호출하므로
// 선택자(selector) 기반 목으로 치환하고, 트리에 폴더 1개만 주입한다.
// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로 folder 객체도 vi.hoisted로 선언.
const { folder } = vi.hoisted(() => ({
  folder: {
    id: 12,
    name: '주간 회의',
    parent_id: null,
    position: 0,
    shared: true,
    important: false,
    meeting_count: 3,
    tags: [],
    children: [],
  } as FolderNode,
}))

vi.mock('../../stores/folderStore', () => {
  const state = {
    folders: [folder],
    selectedFolderId: null,
    expandedFolderIds: new Set<number>(),
    toggleExpanded: vi.fn(),
    renameFolder: vi.fn(),
    removeFolder: vi.fn(),
    setFolderShared: vi.fn(),
    setFolderImportant: vi.fn(),
    createFolder: vi.fn(),
    fetchFolders: vi.fn(),
    moveFolder: vi.fn(),
  }
  const useFolderStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  )
  return { useFolderStore }
})

// ── projectStore ── FolderTreeItem이 currentProjectId를 읽어 프로젝트 이동/도메인파일 다이얼로그에 넘김.
vi.mock('../../stores/projectStore', () => {
  const state = { currentProjectId: 1 }
  const useProjectStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  )
  return { useProjectStore }
})

import FolderTree from './FolderTree'

function renderTree() {
  return render(
    <MemoryRouter>
      <FolderTree />
    </MemoryRouter>,
  )
}

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: /메뉴|more/i }))
}

beforeEach(() => {
  exportFolderSummaries.mockReset()
})

describe('FolderTree 요약 내보내기', () => {
  it('메뉴 항목 클릭 시 exportFolderSummaries 를 호출한다', async () => {
    exportFolderSummaries.mockResolvedValue(undefined)
    renderTree()

    await openMenu()
    await userEvent.click(screen.getByText('요약 내보내기(zip)'))

    await waitFor(() => expect(exportFolderSummaries).toHaveBeenCalledWith(12))
  })

  it('422 실패 시 "내보낼 요약이 없습니다" 를 표시한다', async () => {
    exportFolderSummaries.mockRejectedValue({ response: { status: 422 } })
    renderTree()

    await openMenu()
    await userEvent.click(screen.getByText('요약 내보내기(zip)'))

    expect(await screen.findByText('내보낼 요약이 없습니다')).toBeInTheDocument()
  })

  it('기타 실패 시 "내보내기에 실패했습니다" 를 표시한다', async () => {
    exportFolderSummaries.mockRejectedValue(new Error('network'))
    renderTree()

    await openMenu()
    await userEvent.click(screen.getByText('요약 내보내기(zip)'))

    expect(await screen.findByText('내보내기에 실패했습니다')).toBeInTheDocument()
  })
})

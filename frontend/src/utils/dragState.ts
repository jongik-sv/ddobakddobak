/**
 * Pointer Events 기반 커스텀 드래그앤드롭
 * HTML5 DnD API 대신 사용하여 Tauri WebView 호환성 확보
 */

import { useFolderStore } from '../stores/folderStore'
import { useMeetingStore } from '../stores/meetingStore'
import type { FolderNode } from '../api/folders'

// --- 공유 상태 ---

export const dragState = {
  type: null as 'folder' | 'meeting' | null,
  id: null as number | null,
  active: false,
}

export function clearDrag() {
  dragState.type = null
  dragState.id = null
  dragState.active = false
}

// --- 내부 상태 ---

let currentHighlight: HTMLElement | null = null
let expandTimer: ReturnType<typeof setTimeout> | null = null
let ghostEl: HTMLElement | null = null

// --- 유틸리티 ---

function isDescendantOf(tree: FolderNode[], dragId: number, dropId: number): boolean {
  function find(nodes: FolderNode[], id: number): FolderNode | null {
    for (const n of nodes) {
      if (n.id === id) return n
      const found = find(n.children, id)
      if (found) return found
    }
    return null
  }
  function hasDesc(node: FolderNode, targetId: number): boolean {
    if (node.id === targetId) return true
    return node.children.some((c) => hasDesc(c, targetId))
  }
  const dragNode = find(tree, dragId)
  if (!dragNode) return false
  return hasDesc(dragNode, dropId)
}

function findDropTarget(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y)
  return (el?.closest('[data-drop-folder-id]') as HTMLElement) ?? null
}

function cleanupVisuals() {
  if (currentHighlight) {
    currentHighlight.removeAttribute('data-drag-over')
    currentHighlight = null
  }
  if (expandTimer) {
    clearTimeout(expandTimer)
    expandTimer = null
  }
  if (ghostEl) {
    ghostEl.remove()
    ghostEl = null
  }
  document.body.removeAttribute('data-dragging')
}

// --- 메인 엔트리 ---

export function initDrag(
  type: 'folder' | 'meeting',
  id: number,
  label: string,
  e: React.PointerEvent,
) {
  // 버튼/인풋 위에서 시작하면 무시
  if ((e.target as HTMLElement).closest('button, a, input')) return

  const startX = e.clientX
  const startY = e.clientY
  let started = false

  const onMove = (me: PointerEvent) => {
    if (!started) {
      const dx = me.clientX - startX
      const dy = me.clientY - startY
      if (dx * dx + dy * dy < 36) return // 6px threshold
      started = true
      dragState.type = type
      dragState.id = id
      dragState.active = true
      document.body.setAttribute('data-dragging', 'true')

      // 고스트 생성
      ghostEl = document.createElement('div')
      ghostEl.className = 'drag-ghost'
      ghostEl.textContent = label
      document.body.appendChild(ghostEl)
    }

    // 고스트 위치 업데이트
    if (ghostEl) {
      ghostEl.style.left = `${me.clientX + 14}px`
      ghostEl.style.top = `${me.clientY - 14}px`
    }

    // 드롭 타겟 하이라이트
    const target = findDropTarget(me.clientX, me.clientY)
    if (target !== currentHighlight) {
      if (currentHighlight) currentHighlight.removeAttribute('data-drag-over')
      if (expandTimer) {
        clearTimeout(expandTimer)
        expandTimer = null
      }

      currentHighlight = target
      if (target) {
        target.setAttribute('data-drag-over', 'true')
        // 접힌 폴더 자동 펼침 (700ms)
        const fIdStr = target.getAttribute('data-drop-folder-id')
        if (fIdStr && fIdStr !== 'root') {
          const fId = Number(fIdStr)
          expandTimer = setTimeout(() => {
            const { expandedFolderIds, toggleExpanded } = useFolderStore.getState()
            if (!expandedFolderIds.has(fId)) toggleExpanded(fId)
          }, 700)
        }
      }
    }
  }

  const onUp = async (me: PointerEvent) => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)

    if (!started) return

    // 드래그 후 click 이벤트 차단 (네비게이션 방지)
    const stopClick = (ce: Event) => {
      ce.preventDefault()
      ce.stopPropagation()
    }
    document.addEventListener('click', stopClick, { capture: true, once: true })
    setTimeout(() => document.removeEventListener('click', stopClick, { capture: true }), 200)

    const target = findDropTarget(me.clientX, me.clientY)
    const targetAttr = target?.getAttribute('data-drop-folder-id') ?? null
    const dragType = dragState.type
    const dragId = dragState.id

    cleanupVisuals()
    clearDrag()

    if (!targetAttr || !dragType || !dragId) return
    const targetFolderId = targetAttr === 'root' ? null : Number(targetAttr)

    if (dragType === 'folder') {
      if (targetFolderId === dragId) return
      const { folders, moveFolder } = useFolderStore.getState()
      if (targetFolderId === null && folders.some((f) => f.id === dragId)) return
      if (targetFolderId !== null && isDescendantOf(folders, dragId, targetFolderId)) return

      await moveFolder(dragId, targetFolderId)
      if (targetFolderId !== null) {
        const { expandedFolderIds, toggleExpanded } = useFolderStore.getState()
        if (!expandedFolderIds.has(targetFolderId)) toggleExpanded(targetFolderId)
      }
    } else if (dragType === 'meeting') {
      await useMeetingStore.getState().moveMeetingToFolder(dragId, targetFolderId)
      useFolderStore.getState().fetchFolders()
    }
  }

  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
}

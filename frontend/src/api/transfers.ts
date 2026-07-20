import apiClient from './client'
import { downloadBlob } from '../lib/download'
import { filenameFromDisposition } from './projectTransfers'

/**
 * 회의·폴더 export/import.
 * - 회의 export: POST meetings/:id/export { include_audio } → gzip blob → 다운로드
 * - 회의 import: POST projects/:project_id/meetings/import (multipart file, folder_id?) → { meeting_id, warnings }
 * - 폴더 export:  POST folders/:id/export { include_audio } → gzip blob → 다운로드
 * - 폴더 import:  POST projects/:project_id/folders/import (multipart file, parent_folder_id?) → { folder_id, meeting_ids, warnings }
 *
 * 백엔드 포맷: .ddobak-meeting.tgz / .ddobak-folder.tgz
 */

export interface TransferExportOptions {
  includeAudio: boolean
}

// ── 회의 export ──────────────────────────────────────────────────────────────

/**
 * 회의를 내보내고 브라우저/Tauri 다운로드를 트리거한다.
 * 대용량(음성 포함) 에 대비해 timeout:false.
 */
export async function exportMeeting(
  meetingId: number,
  opts: TransferExportOptions,
): Promise<void> {
  const response = await apiClient.post(`meetings/${meetingId}/export`, {
    json: { include_audio: opts.includeAudio },
    timeout: false,
  })
  const disposition = response.headers.get('content-disposition')
  const filename =
    filenameFromDisposition(disposition) ?? `meeting-${meetingId}.ddobak-meeting.tgz`
  const blob = await response.blob()
  await downloadBlob(blob, filename)
}

// ── 회의 import ──────────────────────────────────────────────────────────────

/**
 * 회의 아카이브 파일을 업로드해 지정 프로젝트(·폴더)에 복원한다.
 * @param projectId 대상 프로젝트 id
 * @param file .ddobak-meeting.tgz 파일
 * @param folderId 가져올 폴더 id(미지정 시 미분류)
 */
export async function importMeeting(
  projectId: number,
  file: File,
  folderId?: number,
): Promise<{ meeting_id: number; warnings: string[] }> {
  const formData = new FormData()
  formData.append('file', file)
  if (folderId != null) {
    formData.append('folder_id', String(folderId))
  }
  return apiClient
    .post(`projects/${projectId}/meetings/import`, { body: formData, timeout: false })
    .json<{ meeting_id: number; warnings: string[] }>()
}

// ── 폴더 export ──────────────────────────────────────────────────────────────

/**
 * 폴더(하위 회의 포함)를 내보내고 다운로드를 트리거한다.
 */
export async function exportFolder(
  folderId: number,
  opts: TransferExportOptions,
): Promise<void> {
  const response = await apiClient.post(`folders/${folderId}/export`, {
    json: { include_audio: opts.includeAudio },
    timeout: false,
  })
  const disposition = response.headers.get('content-disposition')
  const filename =
    filenameFromDisposition(disposition) ?? `folder-${folderId}.ddobak-folder.tgz`
  const blob = await response.blob()
  await downloadBlob(blob, filename)
}

// ── 폴더 import ──────────────────────────────────────────────────────────────

/**
 * 폴더 아카이브 파일을 업로드해 지정 프로젝트에 복원한다.
 * @param projectId 대상 프로젝트 id
 * @param file .ddobak-folder.tgz 파일
 * @param parentFolderId 하위로 가져올 부모 폴더 id(미지정 시 최상위)
 */
export async function importFolder(
  projectId: number,
  file: File,
  parentFolderId?: number,
): Promise<{ folder_id: number; meeting_ids: number[]; warnings: string[] }> {
  const formData = new FormData()
  formData.append('file', file)
  if (parentFolderId != null) {
    formData.append('parent_folder_id', String(parentFolderId))
  }
  return apiClient
    .post(`projects/${projectId}/folders/import`, { body: formData, timeout: false })
    .json<{ folder_id: number; meeting_ids: number[]; warnings: string[] }>()
}

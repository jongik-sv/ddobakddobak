import apiClient from './client'
import { downloadBlob } from '../lib/download'

/**
 * 프로젝트 export/import (시스템 admin 전용).
 * - export: POST projects/:id/export { include_audio } → application/gzip 바이너리 → 다운로드 트리거
 * - import: POST projects/import (multipart file) → { project_id }
 *
 * 백엔드: Api::V1::ProjectTransfersController. .ddobak.tgz(tar.gz) 포맷.
 */

/** Content-Disposition 헤더에서 filename 을 추출한다(따옴표 유무 모두 허용). */
export function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
  return match?.[1] ?? null
}

export interface ExportOptions {
  includeAudio: boolean
  /** Content-Disposition 가 없을 때 쓸 폴백 파일명 베이스(보통 프로젝트 이름). */
  fallbackName: string
}

/**
 * 프로젝트를 내보내고 브라우저/Tauri 다운로드를 트리거한다.
 * ky 응답을 .json() 없이 그대로 받아 blob + Content-Disposition 을 읽는다
 * (useAudioPlayer.download 패턴 — 401 자동 refresh·Authorization 헤더 그대로 적용).
 */
export async function exportProject(projectId: number, opts: ExportOptions): Promise<void> {
  const response = await apiClient.post(`projects/${projectId}/export`, {
    json: { include_audio: opts.includeAudio },
    // 음성 포함 대용량 export 는 처리에 오래 걸려 ky 기본 타임아웃(10s)에 abort 될 수 있어 해제.
    timeout: false,
  })
  const disposition = response.headers.get('content-disposition')
  const filename = filenameFromDisposition(disposition) ?? `${opts.fallbackName}-export.ddobak.tgz`
  const blob = await response.blob()
  await downloadBlob(blob, filename)
}

/**
 * 아카이브 파일을 업로드해 새 프로젝트로 복원하고, 생성된 project_id 를 반환한다.
 * FormData 전송이지만 apiClient(ky)로 보내 401 자동 refresh 를 태운다
 * (ky 는 FormData 면 Content-Type 을 건드리지 않아 multipart boundary 보존).
 */
export async function importProject(file: File): Promise<{ project_id: number }> {
  const formData = new FormData()
  formData.append('file', file)
  // 큰 프로젝트 import 는 14.5s+ 걸려 ky 기본 타임아웃(10s)에 abort → 백엔드는 끝까지
  // 진행해 프로젝트가 생성되는데 프론트는 "실패"로 오인. 타임아웃 해제로 방지.
  return apiClient
    .post('projects/import', { body: formData, timeout: false })
    .json<{ project_id: number }>()
}

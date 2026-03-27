import { IS_TAURI } from '../config'

/**
 * 파일을 다운로드한다.
 * - 브라우저: blob URL + <a download> 패턴
 * - Tauri: 네이티브 저장 다이얼로그 + fs 플러그인
 */
export async function downloadBlob(blob: Blob, defaultFilename: string): Promise<void> {
  if (IS_TAURI) {
    await downloadBlobTauri(blob, defaultFilename)
  } else {
    downloadBlobBrowser(blob, defaultFilename)
  }
}

/**
 * 텍스트 콘텐츠를 파일로 다운로드한다.
 */
export async function downloadText(
  content: string,
  defaultFilename: string,
  mimeType = 'text/plain;charset=utf-8',
): Promise<void> {
  const blob = new Blob([content], { type: mimeType })
  await downloadBlob(blob, defaultFilename)
}

// ── Browser ──────────────────────────────────────

function downloadBlobBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ── Tauri ────────────────────────────────────────

async function downloadBlobTauri(blob: Blob, defaultFilename: string): Promise<void> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')

  const ext = defaultFilename.split('.').pop() ?? ''
  const filters = ext
    ? [{ name: ext.toUpperCase(), extensions: [ext] }]
    : []

  const filePath = await save({
    defaultPath: defaultFilename,
    filters,
  })

  if (!filePath) return // 사용자가 취소

  const arrayBuffer = await blob.arrayBuffer()
  await writeFile(filePath, new Uint8Array(arrayBuffer))
}

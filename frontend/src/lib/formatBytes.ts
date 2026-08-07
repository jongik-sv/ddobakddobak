/**
 * 파일 크기 포맷 헬퍼.
 *
 * `formatSize`는 AddFileDialog/UploadAudioModal에서 완전히 동일하게 중복돼 있던
 * 구현을 공유한다(1024B 미만은 KB로 표기 — 별도 B 단위 분기 없음).
 * `formatFileSize`는 AttachmentCard 전용으로, null 허용 + 1024B 미만은 B 단위로
 * 표기한다는 점에서 출력이 다르므로 통합하지 않고 별도 export로 이동만 한다.
 */

/** 바이트를 KB/MB 단위 문자열로 변환한다(1024B 미만도 KB 표기). */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 바이트를 B/KB/MB 단위 문자열로 변환한다(null은 빈 문자열). */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

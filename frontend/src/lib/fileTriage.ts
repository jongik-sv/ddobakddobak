import type { AttachmentCategory } from '../api/attachments'

// MIME audio/* 또는 확장자 기반 오디오 판별. Tauri 등에서 만든 File은 type이 비어 있을 수 있어
// 확장자도 함께 확인한다.
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'aac', 'flac', 'opus', 'wma', 'amr']

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true
  return AUDIO_EXTENSIONS.includes(extOf(file.name))
}

export function splitDroppedFiles(files: File[]): { audio: File[]; others: File[] } {
  const audio: File[] = []
  const others: File[] = []
  for (const file of files) {
    if (isAudioFile(file)) audio.push(file)
    else others.push(file)
  }
  return { audio, others }
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif']

const AGENDA_PATTERN = /안건|agenda/i
const STAKEHOLDER_PATTERN = /이해관계자|stakeholder|참석자|조직도?/i

export function suggestAttachmentCategory(file: File): AttachmentCategory {
  if (AGENDA_PATTERN.test(file.name)) return 'agenda'
  if (STAKEHOLDER_PATTERN.test(file.name)) return 'stakeholder'
  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(extOf(file.name))) return 'business_card'
  return 'reference'
}

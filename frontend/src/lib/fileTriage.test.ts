import { describe, it, expect } from 'vitest'
import { isAudioFile, splitDroppedFiles, suggestAttachmentCategory } from './fileTriage'

function makeFile(name: string, type = ''): File {
  return new File(['x'], name, { type })
}

describe('isAudioFile', () => {
  it('MIME audio/* 이면 true', () => {
    expect(isAudioFile(makeFile('recording', 'audio/mpeg'))).toBe(true)
  })

  it.each(['mp3', 'wav', 'm4a', 'webm', 'ogg', 'aac', 'flac', 'opus', 'wma', 'amr'])(
    '.%s 확장자면 true (MIME 비어있어도)',
    (ext) => {
      expect(isAudioFile(makeFile(`file.${ext}`))).toBe(true)
    },
  )

  it('오디오 확장자/MIME 아니면 false', () => {
    expect(isAudioFile(makeFile('doc.pdf', 'application/pdf'))).toBe(false)
    expect(isAudioFile(makeFile('image.png', 'image/png'))).toBe(false)
  })

  it('대문자 확장자도 인식', () => {
    expect(isAudioFile(makeFile('FILE.MP3'))).toBe(true)
  })
})

describe('splitDroppedFiles', () => {
  it('오디오/기타로 분리한다', () => {
    const audio1 = makeFile('a.mp3', 'audio/mpeg')
    const pdf = makeFile('b.pdf', 'application/pdf')
    const audio2 = makeFile('c.wav')
    const { audio, others } = splitDroppedFiles([audio1, pdf, audio2])
    expect(audio).toEqual([audio1, audio2])
    expect(others).toEqual([pdf])
  })

  it('빈 배열이면 둘 다 빈 배열', () => {
    const { audio, others } = splitDroppedFiles([])
    expect(audio).toEqual([])
    expect(others).toEqual([])
  })

  it('모두 오디오면 others는 빈 배열', () => {
    const audio1 = makeFile('a.mp3')
    const { audio, others } = splitDroppedFiles([audio1])
    expect(audio).toEqual([audio1])
    expect(others).toEqual([])
  })
})

describe('suggestAttachmentCategory', () => {
  it('파일명에 안건/agenda 포함 → agenda', () => {
    expect(suggestAttachmentCategory(makeFile('안건.pdf'))).toBe('agenda')
    expect(suggestAttachmentCategory(makeFile('meeting-agenda.docx'))).toBe('agenda')
  })

  it('파일명에 이해관계자/stakeholder/참석자/조직도 포함 → stakeholder', () => {
    expect(suggestAttachmentCategory(makeFile('이해관계자.xlsx'))).toBe('stakeholder')
    expect(suggestAttachmentCategory(makeFile('stakeholder_list.csv'))).toBe('stakeholder')
    expect(suggestAttachmentCategory(makeFile('참석자명단.pdf'))).toBe('stakeholder')
    expect(suggestAttachmentCategory(makeFile('조직도.png'))).toBe('stakeholder')
    expect(suggestAttachmentCategory(makeFile('조직.hwp'))).toBe('stakeholder')
  })

  it('이미지 MIME 또는 이미지 확장자 → business_card', () => {
    expect(suggestAttachmentCategory(makeFile('명함사진.jpg', 'image/jpeg'))).toBe('business_card')
    expect(suggestAttachmentCategory(makeFile('scan.png'))).toBe('business_card')
    expect(suggestAttachmentCategory(makeFile('unknown-name', 'image/webp'))).toBe('business_card')
  })

  it('나머지는 reference', () => {
    expect(suggestAttachmentCategory(makeFile('회의자료.docx'))).toBe('reference')
    expect(suggestAttachmentCategory(makeFile('notes.txt'))).toBe('reference')
  })

  it('우선순위: agenda가 stakeholder/이미지보다 먼저', () => {
    expect(suggestAttachmentCategory(makeFile('안건-조직도.png', 'image/png'))).toBe('agenda')
  })

  it('우선순위: stakeholder가 이미지보다 먼저', () => {
    expect(suggestAttachmentCategory(makeFile('조직도.png', 'image/png'))).toBe('stakeholder')
  })
})

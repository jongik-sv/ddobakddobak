import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { LocalMeetingMeta } from '../stt/localStore'
import type { TranscriptFinalData } from '../channels/transcription'

// lib/download의 텍스트/블롭 저장 스파이.
const downloadText = vi.fn().mockResolvedValue(undefined)
const downloadBlob = vi.fn().mockResolvedValue(undefined)
vi.mock('./download', () => ({
  downloadText: (...a: unknown[]) => downloadText(...a),
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
}))

// localStore 스파이 (mp3 우선, WAV 폴백).
const mergeLocalAudio = vi.fn()
const encodeMeetingMp3 = vi.fn()
vi.mock('../stt/localStore', () => ({
  mergeLocalAudio: (...a: unknown[]) => mergeLocalAudio(...a),
  encodeMeetingMp3: (...a: unknown[]) => encodeMeetingMp3(...a),
}))

import {
  transcriptToText,
  transcriptToMarkdown,
  exportTranscript,
  exportAudio,
} from './localExport'

function meta(overrides: Partial<LocalMeetingMeta> = {}): LocalMeetingMeta {
  return {
    localId: 'local-x',
    title: '회의 제목',
    lang: 'ko',
    created_at: '2026-06-01T00:00:00.000Z',
    status: 'completed',
    pendingSync: false,
    ...overrides,
  }
}

function seg(overrides: Partial<TranscriptFinalData> = {}): TranscriptFinalData {
  return {
    id: 1,
    content: '안녕하세요',
    speaker_label: '',
    started_at_ms: 0,
    ended_at_ms: 1000,
    sequence_number: 1,
    applied: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('transcriptToText', () => {
  it('각 세그먼트 content를 줄바꿈으로 잇는다', () => {
    const segs = [seg({ content: '첫째' }), seg({ content: '둘째' })]
    const text = transcriptToText(meta(), segs)
    expect(text).toContain('첫째')
    expect(text).toContain('둘째')
    // 줄 단위로 분리됨
    expect(text.split('\n').filter((l) => l.includes('첫째') || l.includes('둘째'))).toHaveLength(2)
  })
})

describe('transcriptToMarkdown', () => {
  it('[mm:ss] content 형식으로 타임스탬프를 붙인다', () => {
    const segs = [
      seg({ content: '시작', started_at_ms: 0 }),
      seg({ content: '일분오초', started_at_ms: 65000 }),
    ]
    const md = transcriptToMarkdown(meta(), segs)
    expect(md).toContain('[00:00] 시작')
    expect(md).toContain('[01:05] 일분오초')
  })
})

describe('exportTranscript', () => {
  it("fmt='txt' → .txt 파일명으로 downloadText 호출", async () => {
    await exportTranscript(meta({ title: '내 회의' }), [seg()], 'txt')
    expect(downloadText).toHaveBeenCalledTimes(1)
    const [content, filename] = downloadText.mock.calls[0]
    expect(filename).toBe('내 회의.txt')
    expect(content).toContain('안녕하세요')
  })

  it("fmt='md' → .md 파일명 + 타임스탬프 포함", async () => {
    await exportTranscript(meta({ title: '내 회의' }), [seg({ content: '본문', started_at_ms: 0 })], 'md')
    const [content, filename] = downloadText.mock.calls[0]
    expect(filename).toBe('내 회의.md')
    expect(content).toContain('[00:00] 본문')
  })
})

describe('exportAudio', () => {
  it('mp3 인코더 성공 시 mp3 Blob으로 downloadBlob 호출(merge 미호출)', async () => {
    encodeMeetingMp3.mockResolvedValue(new Uint8Array([0xff, 0xfb, 0x10, 0x00]))
    await exportAudio('local-x', meta({ title: '내 회의' }))
    expect(encodeMeetingMp3).toHaveBeenCalledWith('local-x')
    expect(mergeLocalAudio).not.toHaveBeenCalled()
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    const [blob, filename] = downloadBlob.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('audio/mpeg')
    expect(filename).toBe('내 회의.mp3')
  })

  it('mp3 인코더 미가용(null) → 병합 WAV로 폴백', async () => {
    encodeMeetingMp3.mockResolvedValue(null)
    mergeLocalAudio.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
      segmentOffsetsMs: [0],
      durationMs: 1000,
    })
    await exportAudio('local-x', meta({ title: '내 회의' }))
    expect(mergeLocalAudio).toHaveBeenCalledWith('local-x')
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    const [blob, filename] = downloadBlob.mock.calls[0]
    expect(blob.type).toBe('audio/wav')
    expect(filename).toBe('내 회의.wav')
  })

  it('mp3·WAV 모두 없으면 downloadBlob 미호출', async () => {
    encodeMeetingMp3.mockResolvedValue(null)
    mergeLocalAudio.mockResolvedValue(null)
    await exportAudio('local-x', meta())
    expect(downloadBlob).not.toHaveBeenCalled()
  })
})

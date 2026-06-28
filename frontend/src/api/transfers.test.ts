import { describe, it, expect, vi, beforeEach } from 'vitest'

const post = vi.fn()
vi.mock('./client', () => ({
  default: { post: (...a: unknown[]) => post(...a) },
}))

const downloadBlob = vi.fn()
vi.mock('../lib/download', () => ({
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
}))

import {
  exportMeeting,
  importMeeting,
  exportFolder,
  importFolder,
} from './transfers'

beforeEach(() => {
  post.mockReset()
  downloadBlob.mockReset()
})

// ── 회의 export ──────────────────────────────────

describe('exportMeeting', () => {
  it('POSTs export with include_audio and downloads blob using server filename', async () => {
    const blob = new Blob(['data'], { type: 'application/gzip' })
    post.mockReturnValue({
      blob: () => Promise.resolve(blob),
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-disposition'
            ? 'attachment; filename="meeting-7-export.ddobak-meeting.tgz"'
            : null,
      },
    })

    await exportMeeting(7, { includeAudio: true })

    expect(post).toHaveBeenCalledWith('meetings/7/export', {
      json: { include_audio: true },
      timeout: false,
    })
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'meeting-7-export.ddobak-meeting.tgz')
  })

  it('falls back to meeting-<id>.ddobak-meeting.tgz when no Content-Disposition', async () => {
    const blob = new Blob(['data'], { type: 'application/gzip' })
    post.mockReturnValue({
      blob: () => Promise.resolve(blob),
      headers: { get: () => null },
    })

    await exportMeeting(3, { includeAudio: false })

    expect(post).toHaveBeenCalledWith('meetings/3/export', {
      json: { include_audio: false },
      timeout: false,
    })
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'meeting-3.ddobak-meeting.tgz')
  })
})

// ── 회의 import ──────────────────────────────────

describe('importMeeting', () => {
  it('POSTs multipart file without folderId and returns meeting_id', async () => {
    post.mockReturnValue({
      json: () => Promise.resolve({ meeting_id: 42 }),
    })

    const file = new File(['x'], 'meeting.ddobak-meeting.tgz', { type: 'application/gzip' })
    const result = await importMeeting(1, file)

    expect(post).toHaveBeenCalledTimes(1)
    const [path, opts] = post.mock.calls[0] as [string, { body: FormData; timeout: false }]
    expect(path).toBe('projects/1/meetings/import')
    expect(opts.body).toBeInstanceOf(FormData)
    expect((opts.body as FormData).get('file')).toBe(file)
    expect((opts.body as FormData).get('folder_id')).toBeNull()
    expect(result).toEqual({ meeting_id: 42 })
  })

  it('appends folder_id when provided', async () => {
    post.mockReturnValue({
      json: () => Promise.resolve({ meeting_id: 99 }),
    })

    const file = new File(['x'], 'meeting.ddobak-meeting.tgz', { type: 'application/gzip' })
    await importMeeting(1, file, 5)

    const [, opts] = post.mock.calls[0] as [string, { body: FormData }]
    expect((opts.body as FormData).get('folder_id')).toBe('5')
  })
})

// ── 폴더 export ──────────────────────────────────

describe('exportFolder', () => {
  it('POSTs export with include_audio and downloads blob using server filename', async () => {
    const blob = new Blob(['data'], { type: 'application/gzip' })
    post.mockReturnValue({
      blob: () => Promise.resolve(blob),
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-disposition'
            ? 'attachment; filename="folder-10-export.ddobak-folder.tgz"'
            : null,
      },
    })

    await exportFolder(10, { includeAudio: true })

    expect(post).toHaveBeenCalledWith('folders/10/export', {
      json: { include_audio: true },
      timeout: false,
    })
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'folder-10-export.ddobak-folder.tgz')
  })

  it('falls back to folder-<id>.ddobak-folder.tgz when no Content-Disposition', async () => {
    const blob = new Blob(['data'], { type: 'application/gzip' })
    post.mockReturnValue({
      blob: () => Promise.resolve(blob),
      headers: { get: () => null },
    })

    await exportFolder(10, { includeAudio: false })

    expect(downloadBlob).toHaveBeenCalledWith(blob, 'folder-10.ddobak-folder.tgz')
  })
})

// ── 폴더 import ──────────────────────────────────

describe('importFolder', () => {
  it('POSTs multipart file without parentFolderId and returns folder_id + meeting_ids', async () => {
    post.mockReturnValue({
      json: () => Promise.resolve({ folder_id: 20, meeting_ids: [1, 2, 3] }),
    })

    const file = new File(['x'], 'folder.ddobak-folder.tgz', { type: 'application/gzip' })
    const result = await importFolder(1, file)

    expect(post).toHaveBeenCalledTimes(1)
    const [path, opts] = post.mock.calls[0] as [string, { body: FormData; timeout: false }]
    expect(path).toBe('projects/1/folders/import')
    expect(opts.body).toBeInstanceOf(FormData)
    expect((opts.body as FormData).get('file')).toBe(file)
    expect((opts.body as FormData).get('parent_folder_id')).toBeNull()
    expect(result).toEqual({ folder_id: 20, meeting_ids: [1, 2, 3] })
  })

  it('appends parent_folder_id when provided', async () => {
    post.mockReturnValue({
      json: () => Promise.resolve({ folder_id: 21, meeting_ids: [] }),
    })

    const file = new File(['x'], 'folder.ddobak-folder.tgz', { type: 'application/gzip' })
    await importFolder(1, file, 8)

    const [, opts] = post.mock.calls[0] as [string, { body: FormData }]
    expect((opts.body as FormData).get('parent_folder_id')).toBe('8')
  })
})

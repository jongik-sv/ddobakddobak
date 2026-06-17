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
  exportProject,
  importProject,
  filenameFromDisposition,
} from './projectTransfers'

beforeEach(() => {
  post.mockReset()
  downloadBlob.mockReset()
})

describe('filenameFromDisposition', () => {
  it('extracts quoted filename', () => {
    expect(
      filenameFromDisposition('attachment; filename="my-project-export-20260617.ddobak.tgz"'),
    ).toBe('my-project-export-20260617.ddobak.tgz')
  })

  it('extracts unquoted filename', () => {
    expect(filenameFromDisposition('attachment; filename=foo.tgz')).toBe('foo.tgz')
  })

  it('returns null when no filename', () => {
    expect(filenameFromDisposition('attachment')).toBeNull()
    expect(filenameFromDisposition(null)).toBeNull()
  })
})

describe('exportProject', () => {
  it('POSTs export with include_audio and downloads the blob using server filename', async () => {
    const blob = new Blob(['data'], { type: 'application/gzip' })
    post.mockReturnValue({
      blob: () => Promise.resolve(blob),
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-disposition'
            ? 'attachment; filename="dev-export-20260617.ddobak.tgz"'
            : null,
      },
    })

    await exportProject(7, { includeAudio: true, fallbackName: '개발팀' })

    expect(post).toHaveBeenCalledWith('projects/7/export', {
      json: { include_audio: true },
      timeout: false,
    })
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'dev-export-20260617.ddobak.tgz')
  })

  it('falls back to <name>-export.ddobak.tgz when no Content-Disposition', async () => {
    const blob = new Blob(['data'], { type: 'application/gzip' })
    post.mockReturnValue({
      blob: () => Promise.resolve(blob),
      headers: { get: () => null },
    })

    await exportProject(3, { includeAudio: false, fallbackName: '내 프로젝트' })

    expect(post).toHaveBeenCalledWith('projects/3/export', {
      json: { include_audio: false },
      timeout: false,
    })
    expect(downloadBlob).toHaveBeenCalledWith(blob, '내 프로젝트-export.ddobak.tgz')
  })
})

describe('importProject', () => {
  it('POSTs multipart file and returns project_id', async () => {
    post.mockReturnValue({
      json: () => Promise.resolve({ project_id: 42 }),
    })

    const file = new File(['x'], 'p.ddobak.tgz', { type: 'application/gzip' })
    const result = await importProject(file)

    expect(post).toHaveBeenCalledTimes(1)
    const [path, opts] = post.mock.calls[0] as [string, { body: FormData }]
    expect(path).toBe('projects/import')
    expect(opts.body).toBeInstanceOf(FormData)
    expect((opts.body as FormData).get('file')).toBe(file)
    expect(result).toEqual({ project_id: 42 })
  })
})

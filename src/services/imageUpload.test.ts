import { describe, it, expect, vi, beforeEach } from 'vitest'

const upload = vi.fn()
const getPublicUrl = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload, getPublicUrl }) },
  },
  isSupabaseConfigured: true,
}))

import { imageFilesFrom, uploadNoteImage, MAX_IMAGE_BYTES } from './imageUpload'

/**
 * Uploading an image.
 *
 * The checks here mirror the bucket's own `allowed_mime_types` and
 * `file_size_limit`. Duplicating them client-side is not belt-and-braces for
 * its own sake: without it, a 40 MB photo is uploaded in full before the
 * server rejects it, over what is often a phone connection.
 */

function fileOf(type: string, size = 1024, name = 'shot.png'): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockResolvedValue({ error: null })
  getPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://example.supabase.co/storage/v1/object/public/note-images/u/a.png' },
  })
})

describe('uploadNoteImage', () => {
  it('uploads and returns the public URL', async () => {
    const result = await uploadNoteImage('user-1', fileOf('image/png'))

    expect(result).toEqual({
      ok: true,
      src: 'https://example.supabase.co/storage/v1/object/public/note-images/u/a.png',
    })
  })

  /**
   * The first path segment is what the storage policies confine a writer to,
   * and the UUID is the only thing standing between a public-read bucket and
   * someone enumerating other people's images.
   */
  it('files the image under the owner, at an unguessable name', async () => {
    await uploadNoteImage('user-1', fileOf('image/png'))

    const [path] = upload.mock.calls[0]
    expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\.png$/)
  })

  it('does not take the name from the file', async () => {
    await uploadNoteImage('user-1', fileOf('image/png', 1024, 'ada-lovelace-passport.png'))

    const [path] = upload.mock.calls[0]
    expect(path).not.toContain('ada-lovelace')
  })

  it('never overwrites an existing object', async () => {
    await uploadNoteImage('user-1', fileOf('image/png'))

    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: false })
  })

  it('stores jpegs under a jpg extension', async () => {
    await uploadNoteImage('user-1', fileOf('image/jpeg'))

    expect(upload.mock.calls[0][0]).toMatch(/\.jpg$/)
  })

  it('refuses a file that is not an allowed image type', async () => {
    const result = await uploadNoteImage('user-1', fileOf('application/pdf'))

    expect(result.ok).toBe(false)
    expect(upload).not.toHaveBeenCalled()
  })

  it('refuses an SVG, which can carry script', async () => {
    const result = await uploadNoteImage('user-1', fileOf('image/svg+xml'))

    expect(result.ok).toBe(false)
    expect(upload).not.toHaveBeenCalled()
  })

  it('refuses an oversized image before spending the upload', async () => {
    const result = await uploadNoteImage('user-1', fileOf('image/png', MAX_IMAGE_BYTES + 1))

    expect(result.ok).toBe(false)
    expect(result).toHaveProperty('error', expect.stringContaining('limit'))
    expect(upload).not.toHaveBeenCalled()
  })

  it('tells a guest what they can do instead', async () => {
    const result = await uploadNoteImage(null, fileOf('image/png'))

    expect(result.ok).toBe(false)
    expect(result).toHaveProperty('error', expect.stringContaining('address'))
    expect(upload).not.toHaveBeenCalled()
  })

  it('explains a missing bucket as setup rather than as a broken note', async () => {
    upload.mockResolvedValue({ error: { message: 'Bucket not found' } })

    const result = await uploadNoteImage('user-1', fileOf('image/png'))

    expect(result).toEqual({ ok: false, error: 'Image storage is not set up on this project yet.' })
  })

  it('reports an upload failure rather than inserting a broken image', async () => {
    upload.mockResolvedValue({ error: { message: 'network' } })

    const result = await uploadNoteImage('user-1', fileOf('image/png'))

    expect(result.ok).toBe(false)
  })
})

describe('imageFilesFrom', () => {
  function transfer(items: { kind: string; type: string; file: File | null }[]): DataTransfer {
    return {
      items: items.map((item) => ({
        kind: item.kind,
        type: item.type,
        getAsFile: () => item.file,
      })),
    } as unknown as DataTransfer
  }

  it('finds nothing in an empty transfer', () => {
    expect(imageFilesFrom(null)).toEqual([])
    expect(imageFilesFrom(transfer([]))).toEqual([])
  })

  /** A screenshot on the clipboard has no name; a pasted file does. */
  it('takes image files regardless of their name', () => {
    const shot = fileOf('image/png', 1024, '')
    const files = imageFilesFrom(transfer([{ kind: 'file', type: 'image/png', file: shot }]))

    expect(files).toEqual([shot])
  })

  it('ignores pasted text, which the editor handles itself', () => {
    const files = imageFilesFrom(
      transfer([{ kind: 'string', type: 'text/plain', file: null }]),
    )

    expect(files).toEqual([])
  })

  it('ignores non-image files', () => {
    const pdf = fileOf('application/pdf', 1024, 'notes.pdf')
    const files = imageFilesFrom(
      transfer([{ kind: 'file', type: 'application/pdf', file: pdf }]),
    )

    expect(files).toEqual([])
  })

  it('takes every image in a multi-file paste', () => {
    const a = fileOf('image/png')
    const b = fileOf('image/jpeg')
    const files = imageFilesFrom(
      transfer([
        { kind: 'file', type: 'image/png', file: a },
        { kind: 'string', type: 'text/plain', file: null },
        { kind: 'file', type: 'image/jpeg', file: b },
      ]),
    )

    expect(files).toEqual([a, b])
  })
})

import { supabase } from '../lib/supabase'

/**
 * Putting an image into a note.
 *
 * Images were URL-only, which meant the one thing students actually do --
 * paste a screenshot of a lecture slide -- was the one thing they could not
 * do.
 *
 * Guest notes cannot upload. There is no account to file the image under and
 * no bucket prefix to put it in, and the honest answer is to say so rather
 * than to inline a multi-megabyte data URL into a document held in
 * localStorage, which is a quota failure dressed up as a feature.
 */

export const IMAGE_BUCKET = 'note-images'

/** Mirrors `allowed_mime_types` on the bucket. Checked here to fail early. */
const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])

/** Mirrors the bucket's `file_size_limit`. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export type UploadResult =
  | { ok: true; src: string }
  | { ok: false; error: string }

/**
 * The extension to store under, derived from the type rather than the name.
 *
 * SVG is deliberately absent from the allowlist above and so cannot reach
 * here. It is an image the browser will execute script from, and the bucket is
 * public-read: a note is not worth an XSS vector shaped like a diagram.
 */
function extensionFor(type: string): string {
  if (type === 'image/jpeg') return 'jpg'
  return type.slice('image/'.length)
}

function describeSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Uploads one image and returns the URL to put in the document.
 *
 * The path is `<user id>/<uuid>.<ext>`. The first segment is what the storage
 * policies confine a writer to; the UUID is what makes the URL unguessable,
 * which is the only thing standing between a public-read bucket and someone
 * enumerating other people's images. It is deliberately not derived from the
 * file name -- two notes with `screenshot.png` must not collide, and a file
 * name can carry the student's own name into a public URL.
 */
export async function uploadNoteImage(
  userId: string | null,
  file: File,
): Promise<UploadResult> {
  if (!userId) {
    return {
      ok: false,
      error: 'Sign in to add images from your device. You can still insert one by address.',
    }
  }

  if (!ALLOWED.has(file.type)) {
    return {
      ok: false,
      error: file.type
        ? `${file.type} images are not supported. Use PNG, JPEG, GIF, WebP or AVIF.`
        : 'That file does not look like an image.',
    }
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `That image is ${describeSize(file.size)}. The limit is ${describeSize(MAX_IMAGE_BYTES)}.`,
    }
  }

  const path = `${userId}/${crypto.randomUUID()}.${extensionFor(file.type)}`

  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    contentType: file.type,
    // Never overwrite. A UUID collision would mean replacing somebody's image
    // with another, and failing loudly is the right answer to that.
    upsert: false,
  })

  if (error) {
    console.error('[imageUpload] upload failed:', error)
    return {
      ok: false,
      error:
        // The bucket is created by a migration. Saying so is more useful than
        // "Bucket not found", which reads as a bug in the note rather than a
        // step somebody has not run.
        error.message.toLowerCase().includes('bucket')
          ? 'Image storage is not set up on this project yet.'
          : 'That image could not be uploaded. Check your connection and try again.',
    }
  }

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path)
  return { ok: true, src: data.publicUrl }
}

/**
 * The image files in a paste or a drop, if any.
 *
 * Pasting from a screenshot tool puts an image on the clipboard with an empty
 * name; pasting from a file manager puts a real file there. Both arrive as
 * `DataTransferItem`s and both are wanted, so the filter is on kind and type
 * rather than on anything to do with the name.
 */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []

  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

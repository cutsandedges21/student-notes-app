import { generateJSON } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { markdownToHtml } from './markdown'
import { editorExtensions } from '../editor/extensions'

/**
 * Reading a file into a note.
 *
 * Two formats, and only two, because those are the two that are genuinely
 * implemented. `.docx` is a zip of XML and needs a real parser; naming it here
 * before that exists would be the kind of claim this programme has spent its
 * time removing.
 *
 * Parsing goes through the editor's own extension set, so anything the schema
 * does not know is dropped here -- where it is a shorter note the student can
 * see -- rather than on first open, where it would look like data loss.
 */

export const IMPORT_EXTENSIONS = ['.md', '.markdown', '.txt', '.text'] as const

/** What the file picker offers. Kept in step with what is actually parsed. */
export const IMPORT_ACCEPT = '.md,.markdown,.txt,.text,text/markdown,text/plain'

/** Refuses anything that would take a noticeable time to parse or to save. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

export type ImportResult =
  | { ok: true; title: string; content: JSONContent }
  | { ok: false; error: string }

const extensionOf = (name: string): string => {
  const at = name.lastIndexOf('.')
  return at === -1 ? '' : name.slice(at).toLowerCase()
}

/**
 * Takes the title from a leading level-one heading, if there is one.
 *
 * A note exported from here starts with `# Title`, so importing it back should
 * not produce a note whose first line repeats its own name. Anything else
 * falls back to the file name, which is the only other thing that could be the
 * title.
 */
export function splitTitle(markdown: string, fallback: string): { title: string; body: string } {
  const lines = markdown.split(/\r?\n/)
  const firstIndex = lines.findIndex((line) => line.trim() !== '')

  if (firstIndex === -1) return { title: fallback, body: '' }

  const heading = lines[firstIndex].match(/^#\s+(.+)$/)
  if (!heading) return { title: fallback, body: markdown }

  return {
    title: heading[1].trim(),
    body: lines.slice(firstIndex + 1).join('\n').replace(/^\s*\n/, ''),
  }
}

export async function readImportFile(file: File): Promise<ImportResult> {
  const extension = extensionOf(file.name)

  if (!(IMPORT_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      ok: false,
      error:
        extension === '.docx' || extension === '.doc'
          ? 'Word files cannot be imported yet. Save it as Markdown or plain text first.'
          : `${extension || 'That file'} cannot be imported. Use a .md or .txt file.`,
    }
  }

  if (file.size > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 2 MB.`,
    }
  }

  let raw: string
  try {
    raw = await file.text()
  } catch (caught) {
    console.error('[importFile] could not read the file:', caught)
    return { ok: false, error: 'That file could not be read.' }
  }

  /*
   * Checked on the file, not on what is left after the title is taken out. The
   * file name always supplies a fallback title, so testing the title as well
   * meant a blank file was never empty and imported as a note with nothing in
   * it -- which the student then has to notice and delete.
   */
  if (!raw.trim()) return { ok: false, error: 'That file is empty.' }

  // A file name without its extension is the best guess at a title, and the
  // one the student already chose.
  const fallbackTitle = file.name.slice(0, file.name.length - extension.length) || 'Imported note'
  const { title, body } = splitTitle(raw, fallbackTitle)

  try {
    return { ok: true, title, content: generateJSON(markdownToHtml(body), editorExtensions) }
  } catch (caught) {
    console.error('[importFile] could not parse the file:', caught)
    return { ok: false, error: 'That file could not be read as a note.' }
  }
}

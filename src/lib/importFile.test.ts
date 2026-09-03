import { describe, it, expect } from 'vitest'
import { readImportFile, splitTitle, MAX_IMPORT_BYTES } from './importFile'
import { documentToMarkdown } from './exportMarkdown'
import type { JSONContent } from '@tiptap/react'

/**
 * Reading a file into a note.
 *
 * Two formats, because two are implemented. The interesting cases are the
 * refusals: a `.docx` that says what to do instead, and a file that cannot be
 * parsed saying so rather than producing an empty note the student has to work
 * out for themselves.
 */

function fileOf(name: string, contents: string, size?: number): File {
  const file = new File([contents], name, { type: 'text/markdown' })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  return file
}

const textOf = (node: JSONContent): string =>
  node.type === 'text'
    ? (node.text ?? '')
    : (node.content ?? []).map(textOf).join(node.type === 'doc' ? '\n' : '')

describe('splitTitle', () => {
  it('takes a leading heading as the title', () => {
    expect(splitTitle('# Lecture 5\n\nBody.', 'file')).toEqual({
      title: 'Lecture 5',
      body: 'Body.',
    })
  })

  it('falls back to the file name when there is no heading', () => {
    expect(splitTitle('Just body text.', 'Lecture 5')).toEqual({
      title: 'Lecture 5',
      body: 'Just body text.',
    })
  })

  it('is not fooled by a heading further down', () => {
    const { title } = splitTitle('Intro paragraph.\n\n# Later heading', 'file')
    expect(title).toBe('file')
  })

  it('handles an empty file', () => {
    expect(splitTitle('', 'file')).toEqual({ title: 'file', body: '' })
  })
})

describe('readImportFile', () => {
  it('reads a markdown file', async () => {
    const result = await readImportFile(fileOf('notes.md', '# Lecture 5\n\nMitochondria.'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.title).toBe('Lecture 5')
    expect(textOf(result.content)).toContain('Mitochondria')
  })

  it('reads plain text', async () => {
    const result = await readImportFile(fileOf('notes.txt', 'Just some notes.'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // No heading, so the file name is the title.
    expect(result.title).toBe('notes')
  })

  it('brings a list in as a list', async () => {
    const result = await readImportFile(fileOf('n.md', '- One\n- Two'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content.content?.some((node) => node.type === 'bulletList')).toBe(true)
  })

  /**
   * The one refusal worth wording carefully. A student with a .docx is not
   * doing anything unreasonable, and "unsupported file" leaves them stuck.
   */
  it('tells someone with a Word file what to do instead', async () => {
    const result = await readImportFile(fileOf('essay.docx', 'PK...'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Save it as Markdown or plain text')
  })

  it('refuses a format it does not parse, and names it', async () => {
    const result = await readImportFile(fileOf('sheet.csv', 'a,b'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('.csv')
  })

  it('refuses a file too large to be a note', async () => {
    const result = await readImportFile(fileOf('big.md', 'x', MAX_IMPORT_BYTES + 1))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('limit is 2 MB')
  })

  it('refuses an empty file rather than making an empty note', async () => {
    const result = await readImportFile(fileOf('empty.md', '   \n\n  '))

    expect(result.ok).toBe(false)
  })
})

/**
 * Out and back.
 *
 * The whole point of implementing both halves in one go: a note exported and
 * re-imported has to still be the note.
 */
describe('export then import', () => {
  const original: JSONContent = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Glycolysis' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Happens in the cytosol' }] },
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Yield is 2 * 1 ATP' }] },
    ],
  }

  it('comes back as the same note', async () => {
    const markdown = documentToMarkdown(original, 'Lecture 5')
    const result = await readImportFile(fileOf('Lecture 5.md', markdown))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The title came from the exported heading, not from the file name...
    expect(result.title).toBe('Lecture 5')
    // ...and is not repeated in the body.
    expect(textOf(result.content)).not.toContain('# Lecture 5')

    expect(result.content.content?.some((node) => node.type === 'heading')).toBe(true)
    expect(result.content.content?.some((node) => node.type === 'bulletList')).toBe(true)
    // The escaped asterisk survives as an asterisk, not as emphasis.
    expect(textOf(result.content)).toContain('2 * 1 ATP')
  })
})

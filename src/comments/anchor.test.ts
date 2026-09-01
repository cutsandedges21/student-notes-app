import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { editorExtensions } from '../editor/extensions'
import { captureAnchor, describeOrphan, resolveAnchor, type CommentAnchor } from './anchor'

/*
 * Comment anchoring, without a browser.
 *
 * Documents are built straight from the editor's real schema rather than
 * mounted, so these run in milliseconds and still exercise the same node and
 * mark structure the editor produces. The Yjs half needs a live ySync mapping
 * and is covered separately, in the editor tests; what is checked here is the
 * part that has to work whether or not the CRDT can help -- which is the part
 * that decides whether a comment ends up pointing at the wrong sentence.
 */

const schema = getSchema(editorExtensions)

const doc = (...paragraphs: string[]) =>
  ProseMirrorNode.fromJSON(schema, {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: text ? [{ type: 'text', text }] : [],
    })),
  })

/** Finds a phrase the way a person selecting it would. */
function rangeOf(node: ProseMirrorNode, phrase: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null
  node.descendants((child, pos) => {
    if (found || !child.isText) return true
    const at = (child.text ?? '').indexOf(phrase)
    if (at !== -1) found = { from: pos + at, to: pos + at + phrase.length }
    return true
  })
  if (!found) throw new Error(`phrase not in document: ${phrase}`)
  return found
}

describe('captureAnchor', () => {
  it('records the quote and the text either side of it', () => {
    const node = doc('Cellular respiration happens in the mitochondrion.')
    const { from, to } = rangeOf(node, 'the mitochondrion')

    const anchor = captureAnchor(node, from, to)

    expect(anchor.quote).toBe('the mitochondrion')
    expect(anchor.prefix).toContain('happens in ')
    expect(anchor.suffix).toBe('.')
  })

  // Without a Y.Doc there is simply no relative position to record. The
  // comment is still valid; it has one fewer route home.
  it('omits relative positions when the document is not collaborating', () => {
    const node = doc('Some text.')
    const anchor = captureAnchor(node, 1, 5)

    expect(anchor.relativeFrom).toBeUndefined()
    expect(anchor.relativeTo).toBeUndefined()
    expect(anchor.quote).toBeTruthy()
  })

  it('handles a selection at the very start and end of the document', () => {
    const node = doc('Alpha omega')
    const start = captureAnchor(node, 1, 6)
    const end = captureAnchor(node, 7, 12)

    expect(start.quote).toBe('Alpha')
    expect(start.prefix).toBe('')
    expect(end.quote).toBe('omega')
    expect(end.suffix).toBe('')
  })
})

describe('resolveAnchor', () => {
  it('finds an untouched quote', () => {
    const node = doc('Cellular respiration happens in the mitochondrion.')
    const { from, to } = rangeOf(node, 'the mitochondrion')
    const anchor = captureAnchor(node, from, to)

    const result = resolveAnchor(node, anchor)

    expect(result).toEqual({ status: 'resolved', from, to, via: 'quote' })
  })

  /*
   * The property that matters. A comment is made, then somebody types a whole
   * paragraph above it -- every raw position in the document has shifted, and
   * a `{from, to}` anchor now points into the middle of the new text.
   */
  it('survives text being inserted above it', () => {
    const before = doc('Cellular respiration happens in the mitochondrion.')
    const { from, to } = rangeOf(before, 'the mitochondrion')
    const anchor = captureAnchor(before, from, to)

    const after = doc(
      'An entirely new opening paragraph that did not exist before.',
      'Cellular respiration happens in the mitochondrion.',
    )

    const result = resolveAnchor(after, anchor)

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(after.textBetween(result.from, result.to, ' ')).toBe('the mitochondrion')
      // ...and emphatically not where it originally sat.
      expect(result.from).not.toBe(from)
    }
  })

  it('survives the paragraph being moved to the end', () => {
    const before = doc('Target sentence here.', 'Filler.')
    const { from, to } = rangeOf(before, 'Target sentence')
    const anchor = captureAnchor(before, from, to)

    const after = doc('Filler.', 'Something else.', 'Target sentence here.')
    const result = resolveAnchor(after, anchor)

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(after.textBetween(result.from, result.to, ' ')).toBe('Target sentence')
    }
  })

  /*
   * The case raw positions and naive text search both get wrong. The quote
   * occurs four times; only the context says which one was selected.
   */
  describe('a quote that appears more than once', () => {
    const repeated = doc(
      'The mitochondrion makes ATP.',
      'Plants also have a mitochondrion alongside chloroplasts.',
      'A damaged mitochondrion leaks electrons.',
      'Each mitochondrion has two membranes.',
    )

    it('lands on the occurrence that was selected', () => {
      // Captured against the third paragraph, deliberately not the first.
      const source = doc('A damaged mitochondrion leaks electrons.')
      const target = rangeOf(source, 'mitochondrion')
      const anchor = captureAnchor(source, target.from, target.to)

      const result = resolveAnchor(repeated, anchor)

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.via).toBe('context')
        // The occurrence preceded by "damaged", not the first in the document.
        expect(repeated.textBetween(result.from - 8, result.to, ' ')).toContain('damaged')
        // And emphatically not the first occurrence.
        expect(result.from).not.toBe(rangeOf(repeated, 'mitochondrion').from)
      }
    })

    // Context that distinguishes nothing must not be dressed up as an answer.
    it('reports ambiguity rather than picking the first match', () => {
      const anchor: CommentAnchor = { quote: 'mitochondrion', prefix: '', suffix: '' }
      expect(resolveAnchor(repeated, anchor)).toEqual({
        status: 'orphaned',
        reason: 'ambiguous',
      })
    })

    it('reports ambiguity when two occurrences share identical context', () => {
      const twice = doc('Sodium is an ion.', 'Sodium is an ion.')
      const anchor: CommentAnchor = {
        quote: 'is an ion',
        prefix: 'Sodium ',
        suffix: '.',
      }
      expect(resolveAnchor(twice, anchor).status).toBe('orphaned')
    })
  })

  describe('when the passage is gone', () => {
    it('reports it as orphaned rather than attaching to something else', () => {
      const anchor: CommentAnchor = {
        quote: 'a sentence that was deleted',
        prefix: 'before ',
        suffix: ' after',
      }
      expect(resolveAnchor(doc('Completely different text.'), anchor)).toEqual({
        status: 'orphaned',
        reason: 'not-found',
      })
    })

    it('handles an empty document without throwing', () => {
      const anchor: CommentAnchor = { quote: 'anything', prefix: '', suffix: '' }
      expect(resolveAnchor(doc(''), anchor).status).toBe('orphaned')
    })

    it('refuses an anchor with no quote to search for', () => {
      expect(resolveAnchor(doc('Text.'), { quote: '   ', prefix: '', suffix: '' })).toEqual({
        status: 'orphaned',
        reason: 'empty-quote',
      })
    })
  })

  it('resolves a quote that runs across formatting marks', () => {
    const marked = ProseMirrorNode.fromJSON(schema, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'the ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'electron' },
            { type: 'text', text: ' transport chain' },
          ],
        },
      ],
    })

    const result = resolveAnchor(marked, {
      quote: 'the electron transport chain',
      prefix: '',
      suffix: '',
    })

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(marked.textBetween(result.from, result.to, ' ')).toBe(
        'the electron transport chain',
      )
    }
  })

  it('resolves a quote spanning a paragraph boundary', () => {
    const node = doc('First half', 'second half')
    const result = resolveAnchor(node, {
      quote: 'First half second half',
      prefix: '',
      suffix: '',
    })
    expect(result.status).toBe('resolved')
  })

  // A relative position from another document must not be trusted into place.
  it('ignores an unusable relative position and falls back to the quote', () => {
    const node = doc('Cellular respiration happens in the mitochondrion.')
    const result = resolveAnchor(node, {
      quote: 'the mitochondrion',
      prefix: 'happens in ',
      suffix: '.',
      relativeFrom: 'not-valid-base64-@@@',
      relativeTo: 'also-not-valid-@@@',
    })

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.via).toBe('quote')
  })
})

describe('describeOrphan', () => {
  it('gives each reason its own explanation', () => {
    const messages = [
      describeOrphan('not-found'),
      describeOrphan('ambiguous'),
      describeOrphan('empty-quote'),
    ]
    expect(new Set(messages).size).toBe(3)
    for (const message of messages) expect(message.length).toBeGreaterThan(20)
  })
})

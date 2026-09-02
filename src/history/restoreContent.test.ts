import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { editorExtensions } from '../editor/extensions'
import { restoreContent } from './restoreContent'

/**
 * Restoring a version, with and without collaborators.
 *
 * The collaborative case is the one that matters. `DocumentEditor` records
 * that `setContent` under a Yjs binding reaches the CRDT as an insertion
 * rather than a swap, leaving the note holding its own text twice on every
 * screen, permanently. A restore is the worst possible moment for that, so
 * these tests connect two documents and assert both what the restoring client
 * ends up with and what the other one sees.
 */

const editors: Editor[] = []

function makeEditor(content: string): Editor {
  const editor = new Editor({ extensions: editorExtensions, content })
  editors.push(editor)
  return editor
}

/** Two editors bound to Y.Docs that relay updates to each other. */
function makePair(): { a: Editor; b: Editor } {
  const docA = new Y.Doc()
  const docB = new Y.Doc()

  docA.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(docB, update, 'remote')
  })
  docB.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(docA, update, 'remote')
  })

  const make = (doc: Y.Doc) => {
    const editor = new Editor({
      extensions: [...editorExtensions, Collaboration.configure({ document: doc })],
    })
    editors.push(editor)
    return editor
  }

  const a = make(docA)
  const b = make(docB)
  return { a, b }
}

const json = (html: string) => {
  const editor = makeEditor(html)
  return editor.getJSON()
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})

describe('restoreContent', () => {
  it('replaces the document with the stored version', () => {
    const editor = makeEditor('<p>Current draft</p>')
    const version = json('<p>The version worth going back to</p>')

    expect(restoreContent(editor, version)).toEqual({ ok: true })
    expect(editor.state.doc.textContent).toBe('The version worth going back to')
  })

  it('does not leave the old text behind', () => {
    const editor = makeEditor('<p>Current draft</p>')

    restoreContent(editor, json('<p>Restored</p>'))

    expect(editor.state.doc.textContent).not.toContain('Current draft')
  })

  it('restores structure, not just text', () => {
    const editor = makeEditor('<p>flat</p>')

    restoreContent(editor, json('<h1>Title</h1><ul><li>one</li><li>two</li></ul>'))

    expect(editor.getHTML()).toContain('<h1>')
    expect(editor.getHTML()).toContain('<li>')
  })

  it('is one undo step, so the wrong version can be taken back', () => {
    const editor = makeEditor('<p>Current draft</p>')

    restoreContent(editor, json('<p>Restored</p>'))
    editor.commands.undo()

    expect(editor.state.doc.textContent).toBe('Current draft')
  })

  it('refuses content this editor has no schema for', () => {
    const editor = makeEditor('<p>Current draft</p>')

    const result = restoreContent(editor, {
      type: 'doc',
      content: [{ type: 'somethingThisEditorNeverHeardOf' }],
    })

    expect(result).toEqual({ ok: false, reason: 'unparseable' })
    // And the note is untouched, rather than half-restored.
    expect(editor.state.doc.textContent).toBe('Current draft')
  })

  it('refuses when there is no editor', () => {
    expect(restoreContent(null, json('<p>x</p>'))).toEqual({
      ok: false,
      reason: 'no-editor',
    })
  })

  describe('with a collaborator connected', () => {
    it('converges: the other client sees the restored version', () => {
      const { a, b } = makePair()

      a.commands.insertContent('<p>Live draft</p>')
      expect(b.state.doc.textContent).toContain('Live draft')

      restoreContent(a, json('<p>Restored version</p>'))

      expect(a.state.doc.textContent).toBe('Restored version')
      expect(b.state.doc.textContent).toBe('Restored version')
    })

    /**
     * The shape of failure a whole-document replacement can produce under a
     * Yjs binding: applied as an insertion, the note keeps both copies. This
     * asserts the outcome rather than the mechanism, so it stays meaningful
     * whichever way the binding changes underneath.
     */
    it('does not leave the document holding its own text twice', () => {
      const { a, b } = makePair()

      a.commands.insertContent('<p>Live draft</p>')
      restoreContent(a, json('<p>Restored version</p>'))

      expect(a.state.doc.textContent).not.toContain('Live draft')
      expect(b.state.doc.textContent).not.toContain('Live draft')

      const occurrences = b.state.doc.textContent.split('Restored version').length - 1
      expect(occurrences).toBe(1)
    })

    it('leaves both clients agreeing, character for character', () => {
      const { a, b } = makePair()

      a.commands.insertContent('<h2>Notes</h2><p>Something earlier</p>')
      restoreContent(b, json('<h1>Restored</h1><p>Body</p>'))

      expect(a.getHTML()).toBe(b.getHTML())
    })
  })
})

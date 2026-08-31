import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor, getSchema, type JSONContent } from '@tiptap/core'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { editorExtensions } from './extensions'
import {
  applyResolvedSuggestion,
  applySuggestion,
  describeRefusal,
  resolveSuggestionTarget,
  type RefusedTarget,
} from './applySuggestion'

/*
 * jsdom has no layout, so `Range` is missing the CSSOM View methods entirely.
 * `applyResolvedSuggestion` focuses the editor, and ProseMirror measures a
 * Range to scroll the new selection into view -- which throws, and surfaces as
 * an unhandled error that fails the whole run rather than one assertion.
 *
 * Same polyfill as `DocumentEditor.test.tsx`, kept local for the same reason:
 * only the files that put a caret in a document need it.
 */
if (!('getClientRects' in Range.prototype)) {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    value: () => [],
    configurable: true,
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    value: () => ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0 }),
    configurable: true,
  })
}

/*
 * Documents are built with the real editor schema rather than a hand-rolled
 * stand-in.
 *
 * `resolveSuggestionTarget` is pure and only ever reads a `ProseMirrorNode`, so
 * `getSchema(editorExtensions)` + `Node.fromJSON` gives it exactly what it will
 * see in production with none of the cost or flakiness of a live editor: no
 * DOM, no plugins, no measurement. It also means these tests break if the
 * schema changes shape underneath them, which is the point -- a doc built from
 * a fake schema would keep passing while the real one drifted.
 *
 * The tests that *apply* (rather than resolve) need history, commands and a
 * view, so those build a real `Editor`. Tiptap creates its own detached element
 * when none is given, which jsdom is content with.
 */
const schema = getSchema(editorExtensions)

const docOf = (json: JSONContent) => ProseMirrorNode.fromJSON(schema, json)

const text = (value: string, marks?: string[]): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {}),
})

const para = (...content: JSONContent[]): JSONContent => ({
  type: 'paragraph',
  ...(content.length ? { content } : {}),
})

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

/** Live editors created by a test, torn down afterwards. */
const openEditors: Editor[] = []

function createEditor(content: JSONContent): Editor {
  const editor = new Editor({ extensions: editorExtensions, content })
  openEditors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of openEditors.splice(0)) editor.destroy()
})

/**
 * Watches every call to the `setContent` command, whichever way it is reached.
 *
 * `CommandManager` captures `rawCommands` once at construction and every entry
 * point -- `editor.commands.x`, `editor.chain().x()`, `editor.can().x()` --
 * reads that same object, so replacing one function here catches all of them.
 * Spying on `editor.commands` instead would catch nothing: that getter builds a
 * fresh object on every access.
 */
function watchSetContent(editor: Editor) {
  const manager = (editor as unknown as {
    commandManager: { rawCommands: Record<string, (...args: unknown[]) => unknown> }
  }).commandManager
  const spy = vi.fn(manager.rawCommands.setContent)
  manager.rawCommands.setContent = spy
  return spy
}

/** Node type names in document order -- a cheap structural fingerprint. */
function structure(editor: Editor): string[] {
  const types: string[] = []
  editor.state.doc.descendants((node) => {
    types.push(node.type.name)
    return true
  })
  return types
}

describe('resolveSuggestionTarget', () => {
  /*
   * Positions are written out rather than computed so a schema change that
   * moves them fails loudly here instead of quietly agreeing with itself.
   *
   *   para "Alpha"        node 0,  text 1..6,   block 0..7
   *   para "Bravo target" node 7,  text 8..20,  block 7..21
   *   para "Charlie"      node 21, text 22..29, block 21..30
   */
  const threeParagraphs = () =>
    docOf(doc(para(text('Alpha')), para(text('Bravo target')), para(text('Charlie'))))

  it('resolves against the captured range while it still holds the words it was made about', () => {
    const node = threeParagraphs()
    expect(node.textBetween(14, 20, ' ')).toBe('target')

    expect(resolveSuggestionTarget(node, { text: 'target', from: 14, to: 20 })).toEqual({
      status: 'resolved',
      from: 14,
      to: 20,
      source: 'range',
    })
  })

  // The exact failure mode the validation exists for: an unvalidated range is
  // a loaded gun the moment anything above it is edited.
  it('falls through to a textual match when the captured range has gone stale', () => {
    // "Alpha" grew to "Alpha extended", pushing everything below it down by 9.
    const edited = docOf(
      doc(para(text('Alpha extended')), para(text('Bravo target')), para(text('Charlie'))),
    )
    expect(edited.textBetween(14, 20, ' ')).not.toBe('target')

    expect(resolveSuggestionTarget(edited, { text: 'target', from: 14, to: 20 })).toEqual({
      status: 'resolved',
      from: 23,
      to: 29,
      source: 'text',
    })
    expect(edited.textBetween(23, 29, ' ')).toBe('target')
  })

  it('resolves a unique textual match when the suggestion carries no range at all', () => {
    const node = threeParagraphs()

    expect(resolveSuggestionTarget(node, { text: 'Charlie' })).toEqual({
      status: 'resolved',
      from: 22,
      to: 29,
      source: 'text',
    })
  })

  it('trims the captured text before matching it', () => {
    const node = threeParagraphs()

    expect(resolveSuggestionTarget(node, { text: '  Charlie \n' })).toEqual({
      status: 'resolved',
      from: 22,
      to: 29,
      source: 'text',
    })
  })

  it('refuses with not-found when the words are nowhere in the document, and resolves to nothing', () => {
    const node = threeParagraphs()

    const decision = resolveSuggestionTarget(node, {
      text: 'mitochondria make ATP',
      from: 14,
      to: 20,
    })

    expect(decision).toEqual({ status: 'refused', reason: 'not-found' })
    // Belt and braces: a refusal must not smuggle a range out with it.
    expect(decision).not.toHaveProperty('from')
    expect(decision).not.toHaveProperty('to')
  })

  it('refuses as ambiguous and reports how many times the text occurs', () => {
    const node = docOf(
      doc(para(text('the cell wall is thick')), para(text('the cell wall is thin'))),
    )

    expect(resolveSuggestionTarget(node, { text: 'the cell wall' })).toEqual({
      status: 'refused',
      reason: 'ambiguous',
      occurrences: 2,
    })
  })

  it('counts overlapping occurrences separately, because they are still ambiguous', () => {
    const node = docOf(doc(para(text('aaaa'))))

    expect(resolveSuggestionTarget(node, { text: 'aaa' })).toEqual({
      status: 'refused',
      reason: 'ambiguous',
      occurrences: 2,
    })
  })

  it('narrows an otherwise-ambiguous phrase to the region the suggestion came from', () => {
    /*
     *   para "the cell wall is thick" node 0,  text 1..23, block 0..24
     *   para "the cell wall is thin"  node 24, text 25..46, block 24..47
     */
    const node = docOf(
      doc(para(text('the cell wall is thick')), para(text('the cell wall is thin'))),
    )

    expect(
      resolveSuggestionTarget(node, { text: 'the cell wall', scope: { from: 24, to: 47 } }),
    ).toEqual({ status: 'resolved', from: 25, to: 38, source: 'text' })
    expect(node.textBetween(25, 38, ' ')).toBe('the cell wall')
  })

  // A scope's positions age exactly like any others, so a stale one must not be
  // allowed to hide a perfectly good match.
  it('falls through to a whole-document search when the scope matches nothing', () => {
    const node = threeParagraphs()

    expect(
      resolveSuggestionTarget(node, { text: 'Charlie', scope: { from: 0, to: 7 } }),
    ).toEqual({ status: 'resolved', from: 22, to: 29, source: 'text' })
  })

  it('refuses as ambiguous when the scope itself contains the text twice', () => {
    const node = docOf(doc(para(text('the cell and the cell')), para(text('elsewhere'))))

    expect(
      resolveSuggestionTarget(node, { text: 'the cell', scope: { from: 0, to: 23 } }),
    ).toEqual({ status: 'refused', reason: 'ambiguous', occurrences: 2 })
  })

  it('refuses with no-anchor when the target carries no text', () => {
    const node = threeParagraphs()

    expect(resolveSuggestionTarget(node, { text: '' })).toEqual({
      status: 'refused',
      reason: 'no-anchor',
    })
    expect(resolveSuggestionTarget(node, { text: '   \n\t ' })).toEqual({
      status: 'refused',
      reason: 'no-anchor',
    })
    // A range without text is still no anchor: the range alone cannot be
    // validated, and trusting it unvalidated is the bug this module exists for.
    expect(resolveSuggestionTarget(node, { text: '  ', from: 1, to: 6 })).toEqual({
      status: 'refused',
      reason: 'no-anchor',
    })
  })

  it('resolves a match running across several marks as one contiguous range', () => {
    /*
     *   para node 0
     *     "the "               text 1..5
     *     "electron" (bold)    text 5..13
     *     " transport chain"   text 13..29
     */
    const node = docOf(
      doc(para(text('the '), text('electron', ['bold']), text(' transport chain'))),
    )

    const whole = resolveSuggestionTarget(node, { text: 'the electron transport chain' })
    expect(whole).toEqual({ status: 'resolved', from: 1, to: 29, source: 'text' })
    // One range, covering the phrase and nothing else -- not three fragments.
    expect(node.textBetween(1, 29, ' ')).toBe('the electron transport chain')

    // And a match that only straddles the first mark boundary.
    expect(resolveSuggestionTarget(node, { text: 'the electron' })).toEqual({
      status: 'resolved',
      from: 1,
      to: 13,
      source: 'text',
    })
  })

  it('resolves a match spanning a paragraph boundary joined by a single space', () => {
    /*
     *   para "First half"  node 0,  text 1..11, block 0..12
     *   para "second half" node 12, text 13..24
     *
     * The block separator is one space, matching `textBetween(from, to, ' ')`,
     * so "half second" is a real substring of the flattened document.
     */
    const node = docOf(doc(para(text('First half')), para(text('second half'))))

    expect(resolveSuggestionTarget(node, { text: 'half second' })).toEqual({
      status: 'resolved',
      from: 7,
      to: 19,
      source: 'text',
    })
    expect(node.textBetween(7, 19, ' ')).toBe('half second')
  })

  it('refuses rather than throwing on an empty document', () => {
    const emptyParagraph = docOf(doc(para()))
    const noBlocksAtAll = docOf({ type: 'doc', content: [] })

    for (const node of [emptyParagraph, noBlocksAtAll]) {
      expect(() => resolveSuggestionTarget(node, { text: 'anything' })).not.toThrow()
      expect(resolveSuggestionTarget(node, { text: 'anything' })).toEqual({
        status: 'refused',
        reason: 'not-found',
      })
      // A captured range that now runs off the end of the document.
      expect(resolveSuggestionTarget(node, { text: 'anything', from: 1, to: 40 })).toEqual({
        status: 'refused',
        reason: 'not-found',
      })
      expect(resolveSuggestionTarget(node, { text: '' })).toEqual({
        status: 'refused',
        reason: 'no-anchor',
      })
    }
  })

  it('ignores a malformed captured range instead of trusting it', () => {
    const node = threeParagraphs()

    for (const range of [
      { from: -5, to: 6 },
      { from: 20, to: 14 },
      { from: 1.5, to: 6.5 },
      { from: 14, to: 9999 },
    ]) {
      expect(resolveSuggestionTarget(node, { text: 'target', ...range })).toEqual({
        status: 'resolved',
        from: 14,
        to: 20,
        source: 'text',
      })
    }
  })
})

describe('describeRefusal', () => {
  const refusal = (reason: RefusedTarget['reason'], occurrences?: number): RefusedTarget => ({
    status: 'refused',
    reason,
    ...(occurrences === undefined ? {} : { occurrences }),
  })

  it('gives every reason its own message', () => {
    const messages = [
      describeRefusal(refusal('not-found')),
      describeRefusal(refusal('ambiguous', 3)),
      describeRefusal(refusal('no-anchor')),
      describeRefusal(refusal('no-editor')),
    ]

    expect(new Set(messages).size).toBe(4)
    for (const message of messages) expect(message.length).toBeGreaterThan(20)
  })

  it('names the cause and the action for each reason', () => {
    expect(describeRefusal(refusal('not-found'))).toMatch(/couldn't find that text/i)
    expect(describeRefusal(refusal('not-found'))).toMatch(/highlight/i)

    // The count is what makes "ambiguous" actionable rather than mysterious.
    expect(describeRefusal(refusal('ambiguous', 3))).toContain('3')
    expect(describeRefusal(refusal('ambiguous', 3))).toMatch(/highlight/i)

    expect(describeRefusal(refusal('no-anchor'))).toMatch(/lost track/i)
    expect(describeRefusal(refusal('no-anchor'))).toMatch(/highlight/i)

    expect(describeRefusal(refusal('no-editor'))).toMatch(/moment/i)
  })
})

describe('applySuggestion', () => {
  /**
   * The reported failure, as a test.
   *
   * A three-paragraph note, a suggestion generated against the second, the
   * selection cleared before Apply is pressed. This used to run `setContent`
   * over the whole note, so accepting a one-sentence correction destroyed
   * everything else the student had written.
   */
  it('replaces only the paragraph the suggestion was generated for', async () => {
    /*
     *   para one   node 0,  text 1..26,  block 0..27
     *   para two   node 27, text 28..53, block 27..54
     *   para three node 54, text 55..82
     */
    const editor = createEditor(
      doc(
        para(text('Paragraph one, untouched.')),
        para(text('Paragraph two needs work.')),
        para(text('Paragraph three, untouched.')),
      ),
    )
    const before = editor.getJSON()
    const beforeStructure = structure(editor)

    // The student clicked away: there is no selection by the time Apply lands.
    editor.commands.setTextSelection({ from: 1, to: 1 })
    expect(editor.state.selection.empty).toBe(true)

    const result = await applySuggestion(editor, 'Paragraph two is now correct.', {
      text: 'Paragraph two needs work.',
      from: 28,
      to: 53,
    })

    expect(result).toMatchObject({ status: 'applied', source: 'range' })

    const after = editor.getJSON()

    // (i) The neighbours are byte-identical.
    expect(JSON.stringify(after.content?.[0])).toBe(JSON.stringify(before.content?.[0]))
    expect(JSON.stringify(after.content?.[2])).toBe(JSON.stringify(before.content?.[2]))

    // (ii) The document was not replaced: same block count, same node types.
    expect(after.content).toHaveLength(3)
    expect(structure(editor)).toEqual(beforeStructure)

    // (iii) Only paragraph two changed, and it changed to the suggestion.
    expect(editor.state.doc.child(1).textContent).toBe('Paragraph two is now correct.')
    expect(editor.state.doc.child(0).textContent).toBe('Paragraph one, untouched.')
    expect(editor.state.doc.child(2).textContent).toBe('Paragraph three, untouched.')
  })

  it('anchors on the captured text when the selection has moved to another paragraph', async () => {
    const editor = createEditor(
      doc(
        para(text('Paragraph one, untouched.')),
        para(text('Paragraph two needs work.')),
        para(text('Paragraph three, untouched.')),
      ),
    )

    // The student is now highlighting paragraph three. The suggestion still
    // means paragraph two.
    editor.commands.setTextSelection({ from: 55, to: 82 })

    await applySuggestion(editor, 'Rewritten.', { text: 'Paragraph two needs work.' })

    expect(editor.state.doc.child(1).textContent).toBe('Rewritten.')
    expect(editor.state.doc.child(2).textContent).toBe('Paragraph three, untouched.')
  })

  // Guards the guard: an assertion that setContent was never called is worth
  // nothing unless the watcher would have seen it. Both entry points, because
  // `applyResolvedSuggestion` builds a chain rather than calling a command.
  it('the setContent watcher observes both command and chain calls', () => {
    const editor = createEditor(doc(para(text('a'))))
    const setContent = watchSetContent(editor)

    editor.commands.setContent(doc(para(text('b'))))
    expect(setContent).toHaveBeenCalledTimes(1)

    editor.chain().setContent(doc(para(text('c')))).run()
    expect(setContent).toHaveBeenCalledTimes(2)
  })

  it('never calls setContent, on the apply path or the refusal path', async () => {
    const editor = createEditor(
      doc(para(text('Photosynthesis happens in the nucleus.')), para(text('Second line.'))),
    )
    const setContent = watchSetContent(editor)

    const applied = await applySuggestion(editor, 'the chloroplast', {
      text: 'the nucleus',
    })
    expect(applied.status).toBe('applied')

    const refused = await applySuggestion(editor, 'anything at all', {
      text: 'words that are not in this note',
    })
    expect(refused.status).toBe('refused')

    const ambiguous = await applySuggestion(editor, 'anything at all', { text: '.' })
    expect(ambiguous).toMatchObject({ status: 'refused', reason: 'ambiguous' })

    expect(setContent).not.toHaveBeenCalled()
  })

  it('leaves the other issues in a set untouched when one of them is fixed', async () => {
    const editor = createEditor(
      doc(
        para(text('ATP is made in the nucleus.')),
        para(text('The mitochondria stores DNA only.')),
        para(text('Ribosomes build lipids.')),
      ),
    )
    const before = editor.getJSON()

    const result = await applySuggestion(editor, 'The mitochondria makes ATP.', {
      text: 'The mitochondria stores DNA only.',
    })

    expect(result.status).toBe('applied')
    expect(editor.state.doc.child(1).textContent).toBe('The mitochondria makes ATP.')
    // The other two issues' source text is exactly as the model quoted it, so
    // fixing them next still has something to anchor to.
    expect(editor.state.doc.child(0).textContent).toBe('ATP is made in the nucleus.')
    expect(editor.state.doc.child(2).textContent).toBe('Ribosomes build lipids.')
    expect(JSON.stringify(editor.getJSON().content?.[0])).toBe(
      JSON.stringify(before.content?.[0]),
    )
    expect(JSON.stringify(editor.getJSON().content?.[2])).toBe(
      JSON.stringify(before.content?.[2]),
    )
  })

  it('refuses, changes nothing, and does not snapshot when the text has moved', async () => {
    const editor = createEditor(doc(para(text('The original sentence.'))))
    const before = editor.getJSON()
    const beforeApply = vi.fn()

    const result = await applySuggestion(
      editor,
      'A replacement nobody asked for.',
      { text: 'a sentence that is no longer here', from: 1, to: 23 },
      { beforeApply },
    )

    expect(result).toMatchObject({ status: 'refused', reason: 'not-found' })
    expect(result).toHaveProperty('message')
    expect(editor.getJSON()).toEqual(before)
    // A refusal must leave no "before AI" version behind: nothing was applied.
    expect(beforeApply).not.toHaveBeenCalled()
  })

  it('refuses an ambiguous target without touching either occurrence', async () => {
    const editor = createEditor(
      doc(para(text('the cell wall is thick')), para(text('the cell wall is thin'))),
    )
    const before = editor.getJSON()
    const beforeApply = vi.fn()

    const result = await applySuggestion(
      editor,
      'the plasma membrane',
      { text: 'the cell wall' },
      { beforeApply },
    )

    expect(result).toMatchObject({ status: 'refused', reason: 'ambiguous' })
    expect(editor.getJSON()).toEqual(before)
    expect(beforeApply).not.toHaveBeenCalled()
  })

  it('snapshots before writing, but only once the target has resolved', async () => {
    const editor = createEditor(doc(para(text('The original sentence.'))))
    const seenAtSnapshot: string[] = []

    await applySuggestion(
      editor,
      'The improved sentence.',
      { text: 'The original sentence.' },
      { beforeApply: () => void seenAtSnapshot.push(editor.state.doc.textContent) },
    )

    expect(seenAtSnapshot).toEqual(['The original sentence.'])
    expect(editor.state.doc.textContent).toBe('The improved sentence.')
  })

  // `beforeApply` can be a round trip to the server, and the student keeps
  // typing while it is in flight.
  it('re-resolves the target after the snapshot, so an edit in flight cannot misplace it', async () => {
    const editor = createEditor(
      doc(para(text('Intro.')), para(text('The target sentence.'))),
    )

    const result = await applySuggestion(
      editor,
      'The corrected sentence.',
      { text: 'The target sentence.', from: 9, to: 29 },
      {
        beforeApply: async () => {
          // Something above the range grows while the snapshot is in flight.
          editor.commands.insertContentAt(1, 'A much longer intro paragraph now. ')
          await Promise.resolve()
        },
      },
    )

    expect(result.status).toBe('applied')
    expect(editor.state.doc.child(1).textContent).toBe('The corrected sentence.')
    expect(editor.state.doc.child(0).textContent).toBe('A much longer intro paragraph now. Intro.')
  })

  it('refuses when the text disappears while the snapshot is in flight', async () => {
    const editor = createEditor(doc(para(text('The target sentence.'))))

    const result = await applySuggestion(
      editor,
      'The corrected sentence.',
      { text: 'The target sentence.', from: 1, to: 21 },
      {
        beforeApply: async () => {
          editor.commands.setTextSelection({ from: 1, to: 21 })
          editor.commands.insertContent('Something else entirely.')
          await Promise.resolve()
        },
      },
    )

    expect(result).toMatchObject({ status: 'refused', reason: 'not-found' })
    expect(editor.state.doc.textContent).toBe('Something else entirely.')
  })

  it('refuses with no-editor rather than throwing when there is nothing to write into', async () => {
    expect(await applySuggestion(null, 'anything', { text: 'anything' })).toMatchObject({
      status: 'refused',
      reason: 'no-editor',
    })

    const editor = new Editor({ extensions: editorExtensions, content: doc(para(text('Hi'))) })
    editor.destroy()

    expect(await applySuggestion(editor, 'anything', { text: 'Hi' })).toMatchObject({
      status: 'refused',
      reason: 'no-editor',
    })
  })

  it('applies a multi-line suggestion as block content', async () => {
    const editor = createEditor(doc(para(text('Replace me.')), para(text('Keep me.'))))

    const result = await applySuggestion(editor, '- first\n- second', { text: 'Replace me.' })

    expect(result.status).toBe('applied')
    expect(editor.state.doc.textContent).toContain('first')
    expect(editor.state.doc.textContent).toContain('second')
    expect(editor.state.doc.lastChild?.textContent).toBe('Keep me.')
  })
})

describe('undo after an AI edit', () => {
  it('takes the whole AI edit back out in a single step', async () => {
    const editor = createEditor(
      doc(para(text('Paragraph one.')), para(text('Paragraph two needs work.'))),
    )
    const before = editor.getJSON()

    const result = await applySuggestion(editor, 'Paragraph two is now correct.', {
      text: 'Paragraph two needs work.',
    })
    expect(result.status).toBe('applied')
    expect(editor.getJSON()).not.toEqual(before)

    editor.commands.undo()

    expect(editor.getJSON()).toEqual(before)
  })

  /*
   * The reason `applyResolvedSuggestion` calls `closeHistory`, and the only
   * shape of test that actually exercises it.
   *
   * ProseMirror starts a new undo group when a transaction is either late (more
   * than `newGroupDelay`, half a second) or lands somewhere unrelated to the
   * last one. An AI edit in a *different* paragraph from the typing therefore
   * gets its own group for free, and a test built that way passes with
   * `closeHistory` deleted -- it proves nothing.
   *
   * So the typing here happens inside the very words the suggestion goes on to
   * replace: same instant, overlapping ranges, which is precisely when history
   * would merge them. Without `closeHistory` this one undo also removes the
   * " really" the student typed. Verified by mutation: dropping the call leaves
   * "The nucleus makes ATP." behind instead of "The nucleus really makes ATP.".
   */
  it('does not swallow the keystrokes typed into the same words a moment before', async () => {
    const editor = createEditor(doc(para(text('The nucleus makes ATP.'))))

    editor.commands.setTextSelection(12)
    editor.commands.insertContent(' really')
    const afterTyping = editor.getJSON()
    expect(editor.state.doc.textContent).toBe('The nucleus really makes ATP.')

    const result = await applySuggestion(editor, 'The mitochondrion really makes ATP.', {
      text: 'The nucleus really makes ATP.',
    })
    expect(result.status).toBe('applied')
    expect(editor.state.doc.textContent).toBe('The mitochondrion really makes ATP.')

    editor.commands.undo()

    expect(editor.getJSON()).toEqual(afterTyping)
    expect(editor.state.doc.textContent).toBe('The nucleus really makes ATP.')
  })

  it('leaves the typing itself undoable by a second step', async () => {
    const editor = createEditor(doc(para(text('The nucleus makes ATP.'))))
    const original = editor.getJSON()

    editor.commands.setTextSelection(12)
    editor.commands.insertContent(' really')
    await applySuggestion(editor, 'The mitochondrion really makes ATP.', {
      text: 'The nucleus really makes ATP.',
    })

    editor.commands.undo()
    editor.commands.undo()

    expect(editor.getJSON()).toEqual(original)
  })

  it('is a single step for applyResolvedSuggestion used directly too', () => {
    const editor = createEditor(doc(para(text('The old wording here.'))))
    const before = editor.getJSON()

    applyResolvedSuggestion(editor, 'The new wording here.', { from: 1, to: 22 })
    expect(editor.state.doc.textContent).toBe('The new wording here.')

    editor.commands.undo()

    expect(editor.getJSON()).toEqual(before)
  })
})

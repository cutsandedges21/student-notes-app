import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentEditor } from './DocumentEditor'

/*
 * jsdom has no layout, so `Range` is missing the CSSOM View methods entirely.
 * Entering a header focuses it, and ProseMirror measures a Range to scroll the
 * new selection into view -- which throws, and surfaces as an unhandled error
 * that fails the whole run rather than one assertion.
 *
 * Kept local to this file rather than added to the shared setup: only the
 * tests that step inside a page zone need it.
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

const paragraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('DocumentEditor', () => {
  it('mounts the editor and renders the formatting toolbar', () => {
    render(
      <DocumentEditor
        documentId="doc-1"
        version={1}
        initialContent={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
  })

  it('swaps content when navigating to a different document', () => {
    const { rerender } = render(
      <DocumentEditor
        documentId="doc-1"
        version={1}
        initialContent={paragraph('First note')}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Note content')).toHaveTextContent('First note')

    rerender(
      <DocumentEditor
        documentId="doc-2"
        version={1}
        initialContent={paragraph('Second note')}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Note content')).toHaveTextContent('Second note')
  })

  // Regression: when a save is rejected as stale, EditorPage re-reads the
  // document and adopts the newer remote content. The document id does not
  // change, only the version does. If the editor does not re-sync on version
  // change, it keeps displaying the local text while the page's versionRef
  // advances to the remote version -- so the next keystroke saves the local
  // content over the other tab's newer work with a now-valid version,
  // silently destroying it. That is the exact data loss the optimistic
  // concurrency check exists to prevent.
  it('adopts newer remote content when the version advances for the same document', () => {
    const { rerender } = render(
      <DocumentEditor
        documentId="doc-1"
        version={5}
        initialContent={paragraph('Local unsaved edit')}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Note content')).toHaveTextContent('Local unsaved edit')

    rerender(
      <DocumentEditor
        documentId="doc-1"
        version={6}
        initialContent={paragraph('Newer content from another tab')}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Note content')).toHaveTextContent(
      'Newer content from another tab',
    )
  })

  /*
   * Page furniture belongs to the document it was loaded for.
   *
   * `PageZone` owns its own Tiptap instance, and Tiptap's `content` option is
   * initial content only -- a live instance never re-reads it. Because this
   * component deliberately swaps the body in place rather than remounting when
   * navigating between notes, an unkeyed zone kept note A's instance alive
   * across the move to note B: B displayed A's header and footer, and the first
   * keystroke inside B's header emitted A's text, which the page then saved
   * onto B. Two notes, one header, and the wrong one wins.
   */
  describe('page furniture isolation', () => {
    const zone = (text: string) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })

    const emptyZone = { type: 'doc', content: [{ type: 'paragraph' }] }

    it('renders the header and footer of the loaded document', () => {
      render(
        <DocumentEditor
          documentId="doc-a"
          version={1}
          initialContent={paragraph('Note A body')}
          header={zone('Biology 101 — Unit 3')}
          footer={zone('Prepared by Sam')}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByLabelText('Header content')).toHaveTextContent('Biology 101 — Unit 3')
      expect(screen.getByLabelText('Footer content')).toHaveTextContent('Prepared by Sam')
    })

    it('does not show the previous note’s header or footer after navigating', () => {
      const { rerender } = render(
        <DocumentEditor
          documentId="doc-a"
          version={1}
          initialContent={paragraph('Note A body')}
          header={zone('Biology 101 — Unit 3')}
          footer={zone('Prepared by Sam')}
          onChange={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('Header content')).toHaveTextContent('Biology 101 — Unit 3')

      rerender(
        <DocumentEditor
          documentId="doc-b"
          version={1}
          initialContent={paragraph('Note B body')}
          header={zone('Chemistry — Term 2')}
          footer={zone('Group project')}
          onChange={vi.fn()}
        />,
      )

      const header = screen.getByLabelText('Header content')
      const footer = screen.getByLabelText('Footer content')

      expect(header).toHaveTextContent('Chemistry — Term 2')
      expect(footer).toHaveTextContent('Group project')
      // The point of the test: not a trace of note A is left on the page.
      expect(header).not.toHaveTextContent('Biology')
      expect(footer).not.toHaveTextContent('Sam')
      expect(document.body.textContent).not.toContain('Biology 101')
      expect(document.body.textContent).not.toContain('Prepared by Sam')
    })

    // Loading is not an edit. A change reported here would be autosaved, which
    // is how note A's header got written onto note B in the first place.
    it('reports no furniture change while another note is being loaded', () => {
      const onHeaderChange = vi.fn()
      const onFooterChange = vi.fn()

      const { rerender } = render(
        <DocumentEditor
          documentId="doc-a"
          version={1}
          initialContent={paragraph('Note A body')}
          header={zone('Header A')}
          footer={zone('Footer A')}
          onHeaderChange={onHeaderChange}
          onFooterChange={onFooterChange}
          onChange={vi.fn()}
        />,
      )

      rerender(
        <DocumentEditor
          documentId="doc-b"
          version={1}
          initialContent={paragraph('Note B body')}
          header={zone('Header B')}
          footer={zone('Footer B')}
          onHeaderChange={onHeaderChange}
          onFooterChange={onFooterChange}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByLabelText('Header content')).toHaveTextContent('Header B')
      expect(onHeaderChange).not.toHaveBeenCalled()
      expect(onFooterChange).not.toHaveBeenCalled()
    })

    it('sends an edit to the note on screen and never mutates the one left behind', async () => {
      const headerA = zone('Header A')
      const headerASnapshot = JSON.parse(JSON.stringify(headerA))
      const onHeaderChange = vi.fn()

      const { rerender } = render(
        <DocumentEditor
          documentId="doc-a"
          version={1}
          initialContent={paragraph('Note A body')}
          header={headerA}
          onHeaderChange={onHeaderChange}
          onChange={vi.fn()}
        />,
      )

      rerender(
        <DocumentEditor
          documentId="doc-b"
          version={1}
          initialContent={paragraph('Note B body')}
          header={zone('Header B')}
          onHeaderChange={onHeaderChange}
          onChange={vi.fn()}
        />,
      )

      await userEvent.dblClick(screen.getByLabelText('Header area'))
      await userEvent.type(screen.getByLabelText('Header content'), '!')

      expect(onHeaderChange).toHaveBeenCalled()
      const emitted = JSON.stringify(onHeaderChange.mock.calls.at(-1)?.[0])
      expect(emitted).toContain('Header B')
      expect(emitted).not.toContain('Header A')

      // The furniture handed in for note A is the page's own state object. A
      // zone that wrote through to it would corrupt the note it came from.
      expect(headerA).toEqual(headerASnapshot)
    })

    it('opens a note with no furniture empty, after one that had some', () => {
      const { rerender } = render(
        <DocumentEditor
          documentId="doc-a"
          version={1}
          initialContent={paragraph('Note A body')}
          header={zone('Header A')}
          footer={zone('Footer A')}
          onChange={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('Header content')).toHaveTextContent('Header A')

      rerender(
        <DocumentEditor
          documentId="doc-b"
          version={1}
          initialContent={paragraph('Note B body')}
          header={emptyZone}
          footer={emptyZone}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByLabelText('Header content')).toHaveTextContent('')
      expect(screen.getByLabelText('Footer content')).toHaveTextContent('')
      expect(document.body.textContent).not.toContain('Header A')
      expect(document.body.textContent).not.toContain('Footer A')
    })

    // The stale-save re-read path: the page adopts newer remote content under
    // an unchanged id, so only the version moves. Furniture has to follow, or
    // the next keystroke saves the local header over the other tab's newer one.
    it('adopts newer remote furniture when only the version advances', () => {
      const { rerender } = render(
        <DocumentEditor
          documentId="doc-a"
          version={5}
          initialContent={paragraph('Local unsaved edit')}
          header={zone('Stale local header')}
          footer={zone('Stale local footer')}
          onChange={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('Header content')).toHaveTextContent('Stale local header')

      rerender(
        <DocumentEditor
          documentId="doc-a"
          version={6}
          initialContent={paragraph('Newer content from another tab')}
          header={zone('Newer remote header')}
          footer={zone('Newer remote footer')}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByLabelText('Header content')).toHaveTextContent('Newer remote header')
      expect(screen.getByLabelText('Footer content')).toHaveTextContent('Newer remote footer')
      expect(document.body.textContent).not.toContain('Stale local')
    })

    /*
     * The zone remounts underneath the writer on navigation. Remounting while
     * the zone is still the active one would drop them inside a header of a
     * note they never opened, and the next keystroke would land in it.
     *
     * Asserted through `contenteditable` rather than `toHaveFocus`. Being in a
     * zone is what `contenteditable` reports -- `PageZone` calls
     * `setEditable(active)` -- so it is the state this test is actually about.
     * Caret placement is a second-order effect of it, and one jsdom cannot
     * observe: Tiptap's `focus()` command moves the ProseMirror selection, but
     * without layout jsdom never moves DOM focus with it. Where the caret
     * physically lands after navigating belongs to an E2E test, not here.
     */
    it('does not leave the writer inside the new note’s header', async () => {
      const { rerender } = render(
        <DocumentEditor
          documentId="doc-a"
          version={1}
          initialContent={paragraph('Note A body')}
          header={zone('Header A')}
          onChange={vi.fn()}
        />,
      )

      await userEvent.dblClick(screen.getByLabelText('Header area'))
      expect(screen.getByLabelText('Header content')).toHaveAttribute('contenteditable', 'true')

      rerender(
        <DocumentEditor
          documentId="doc-b"
          version={1}
          initialContent={paragraph('Note B body')}
          header={zone('Header B')}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByLabelText('Header content')).toHaveTextContent('Header B')
      expect(screen.getByLabelText('Header content')).toHaveAttribute('contenteditable', 'false')
    })
  })

  // role="toolbar" promises assistive technology a single tab stop with arrow
  // navigation between controls. Without it the role misrepresents the widget.
  describe('toolbar keyboard navigation', () => {
    const renderToolbar = () =>
      render(
        <DocumentEditor
          documentId="doc-1"
          version={1}
          initialContent={paragraph('Text')}
          onChange={vi.fn()}
        />,
      )

    it('moves focus to the next control with ArrowRight', async () => {
      renderToolbar()
      screen.getByRole('button', { name: 'Bold' }).focus()

      await userEvent.keyboard('{ArrowRight}')

      expect(screen.getByRole('button', { name: 'Italic' })).toHaveFocus()
    })

    it('moves focus to the previous control with ArrowLeft', async () => {
      renderToolbar()
      screen.getByRole('button', { name: 'Italic' }).focus()

      await userEvent.keyboard('{ArrowLeft}')

      expect(screen.getByRole('button', { name: 'Bold' })).toHaveFocus()
    })

    it('exposes a single tab stop, so Tab does not walk every button', () => {
      renderToolbar()

      // Scoped to the toolbar: the editor also renders controls outside it
      // (the view-mode bubble), which are their own tab stops by design. The
      // invariant being asserted is about the toolbar's roving tabindex.
      const toolbar = screen.getByRole('toolbar', { name: 'Text formatting' })
      const tabbable = Array.from(toolbar.querySelectorAll('button')).filter(
        (button) => button.tabIndex === 0,
      )

      expect(tabbable).toHaveLength(1)
    })
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocumentEditor } from './DocumentEditor'

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

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})

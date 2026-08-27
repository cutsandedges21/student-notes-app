import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocumentEditor } from './DocumentEditor'

describe('DocumentEditor', () => {
  it('mounts the editor and renders the formatting toolbar', () => {
    render(
      <DocumentEditor
        documentId="doc-1"
        initialContent={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
  })
})

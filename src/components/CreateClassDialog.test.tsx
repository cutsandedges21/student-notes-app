import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateClassDialog } from './CreateClassDialog'

/**
 * Regression cover for a silent failure.
 *
 * The dialog used to wrap the create in try/finally with no catch. When the
 * insert was rejected -- which it was for every signed-in user while the slug
 * columns were missing from the project -- the rejection escaped, the dialog
 * stayed open with the fields still filled, and nothing on screen changed. The
 * button looked dead. It has to say what went wrong instead.
 */
describe('CreateClassDialog', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  afterEach(() => errors.mockClear())

  async function fillAndSubmit() {
    await userEvent.type(screen.getByLabelText('Class name'), 'Biology 101')
    await userEvent.click(screen.getByRole('button', { name: 'Create class' }))
  }

  it('reports the cause and stays open when the create fails', async () => {
    // The exact payload the live project returned with the migration outstanding.
    const onCreate = vi.fn().mockRejectedValue({
      code: 'PGRST204',
      message: "Could not find the 'slug' column of 'classes' in the schema cache",
    })
    const onClose = vi.fn()

    render(<CreateClassDialog open onClose={onClose} onCreate={onCreate} />)
    await fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent(/supabase\/schema\.sql/i)
    expect(onClose).not.toHaveBeenCalled()
    // The typed name survives, so a retry after fixing the cause is one click.
    expect(screen.getByLabelText('Class name')).toHaveValue('Biology 101')
  })

  it('closes without an alert when the create succeeds', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(<CreateClassDialog open onClose={onClose} onCreate={onCreate} />)
    await fillAndSubmit()

    expect(onCreate).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

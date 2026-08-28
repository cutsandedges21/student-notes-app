import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SignUpPage from './SignUpPage'

const signUp = vi.fn()
const navigate = vi.fn()

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ signUp }),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}))

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Name'), 'Test Student')
  await userEvent.type(screen.getByLabelText('Email'), 'student@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'TestPassword123!')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('SignUpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>,
    )
  })

  // Supabase creates the account but withholds a session when "Confirm email"
  // is on. Navigating into the app at that point strands the user in a
  // signed-out view with no explanation -- which is how a confirmation
  // requirement gets misread as a broken login.
  it('tells the user to check their email when confirmation is pending', async () => {
    signUp.mockResolvedValue({ needsEmailConfirmation: true })

    await fillAndSubmit()

    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText(/student@example\.com/)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('goes straight into the app when no confirmation is required', async () => {
    signUp.mockResolvedValue({ needsEmailConfirmation: false })

    await fillAndSubmit()

    expect(navigate).toHaveBeenCalledWith('/classes', { replace: true })
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument()
  })

  it('surfaces an actionable message when signup fails', async () => {
    signUp.mockRejectedValue(
      Object.assign(new Error('User already registered'), { code: 'user_already_exists' }),
    )

    await fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with that email already exists.',
    )
  })
})

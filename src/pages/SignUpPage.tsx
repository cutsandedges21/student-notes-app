import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'
import { describeAuthError } from '../lib/authErrors'

export default function SignUpPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      return
    }

    setSubmitting(true)
    try {
      const { needsEmailConfirmation } = await signUp(email, password, displayName.trim())

      if (needsEmailConfirmation) {
        setConfirmationSentTo(email)
        return
      }

      navigate('/classes', { replace: true })
    } catch (caught) {
      console.error('[SignUpPage] sign-up failed:', caught)
      setError(describeAuthError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmationSentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={`We sent a confirmation link to ${confirmationSentTo}.`}
        footer={
          <Link to="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="rounded border border-line bg-surface px-4 py-3">
          <p className="text-sm text-ink-muted">
            Click the link in that email to activate your account, then sign in. You
            won&rsquo;t be able to sign in until it&rsquo;s confirmed.
          </p>
          <p className="mt-3 text-sm text-ink-muted">
            Nothing there? Check your spam folder.
          </p>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Your class notes, in one place."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Name"
          autoComplete="name"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}

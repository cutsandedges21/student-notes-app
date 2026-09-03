import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../contexts/AuthContext'
import { describeAuthError } from '../lib/authErrors'
import { safeReturnTo, signUpHref } from '../lib/returnTo'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email, password)
      // Back where they came from, which for a share link is the note they
      // were trying to open. Validated: `next` comes from the query string.
      navigate(returnTo, { replace: true })
    } catch (caught) {
      console.error('[LoginPage] sign-in failed:', caught)
      setError(describeAuthError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          Need an account?{' '}
          <Link to={signUpHref(returnTo)} className="text-accent hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={submitting}>
          Sign in
        </Button>
        <Link to="/forgot-password" className="text-sm text-ink-muted hover:text-ink">
          Forgot your password?
        </Link>
      </form>
    </AuthLayout>
  )
}

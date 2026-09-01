import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppDocIcon } from '../editor/DocsIcons'
import { LoadingScreen } from '../components/LoadingScreen'
import { useAuth } from '../contexts/AuthContext'
import { canViewDocument, fetchSharedDocument, redeemShareToken } from '../services/sharing'
import { loginHref, signUpHref } from '../lib/returnTo'
import { describeDataError, detailDataError } from '../lib/dataErrors'
import { noteHref, sharedNoteHref } from '../lib/noteRef'

/**
 * What a share link does.
 *
 * It used to open a second, lesser editor: its own save path through a token
 * function, its own version handling, no menu bar, no toolbar, no comments,
 * and a "Make a copy" button that produced a private note sharing nothing.
 * Everything collaboration needs -- one document both people can address --
 * was missing by construction, so carets, live edits and comments could not
 * have worked however they were wired.
 *
 * So this page no longer renders a note. It turns a link into access and then
 * gets out of the way: redeem the token, which records the grant that RLS and
 * Realtime both authorise against, then send the visitor to the real editor at
 * the note's own address. From that point a collaborator's screen is the
 * owner's screen, because it is the same page loading the same row.
 *
 * A signed-out visitor cannot be granted anything -- redeem_share_token
 * refuses a null auth.uid(), as does every write path -- so they are offered
 * the sign-in that brings them back here.
 */
export default function SharedLinkPage() {
  const { token } = useParams<{ token: string }>()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  /*
   * Three failures, not one.
   *
   * 'unavailable' means the token resolved to nothing -- unknown, revoked, or
   * sharing switched off -- and those are deliberately indistinguishable,
   * because telling them apart tells a stranger which notes exist.
   *
   * 'access-failed' is different in kind: the link is real and the note is
   * shared, but recording the grant did not work. Reporting that as "this link
   * isn't available" blames the link for a fault on our side and leaves the
   * person with nothing to do, so it says what happened and offers a retry.
   */
  const [state, setState] = useState<
    'working' | 'signed-out' | 'unavailable' | 'access-failed'
  >('working')
  const [title, setTitle] = useState<string>('')
  const [reason, setReason] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!token || authLoading) return
    let cancelled = false

    void (async () => {
      const shared = await fetchSharedDocument(token).catch((caught) => {
        console.error('[SharedLinkPage] failed to read the link:', caught)
        return null
      })

      if (cancelled) return

      // Unknown token, revoked link and private note are one answer on
      // purpose: telling them apart is telling a stranger which notes exist.
      if (!shared) {
        setState('unavailable')
        return
      }

      setTitle(shared.title)

      if (!user) {
        setState('signed-out')
        return
      }

      // The owner following their own link goes to it where they filed it.
      if (shared.owner_id === user.id) {
        navigate(noteHref(shared.class_slug, shared.slug, shared.id), { replace: true })
        return
      }

      /*
       * The grant is what makes everything else work: RLS on documents,
       * Realtime's authorisation of the note's channel, and comment
       * visibility all check document_access, none of them check the token.
       * A failure here is fatal to the journey, so unlike before it is
       * reported rather than logged and stepped past.
       */
      let grant: Awaited<ReturnType<typeof redeemShareToken>> = null
      let failure: string | null = null
      try {
        grant = await redeemShareToken(token)
      } catch (caught) {
        console.error('[SharedLinkPage] could not record access:', caught)
        // Supabase errors are plain objects, so String() on one gives
        // "[object Object]" -- which is what this screen used to show.
        failure = `${describeDataError(caught)}

${detailDataError(caught)}`
      }

      if (cancelled) return

      /*
       * A failed grant is not automatically a closed door. The row may already
       * exist from an earlier visit, in which case access is real and only the
       * re-recording of it went wrong -- locking somebody out of a note they
       * can demonstrably open would be losing them the note over bookkeeping.
       * Asks the same function the RLS policies ask, so this is the answer
       * that actually governs access.
       */
      if (!grant && failure) {
        const already = await canViewDocument(shared.id).catch(() => false)
        if (cancelled) return
        if (already) {
          navigate(sharedNoteHref(shared.slug, shared.id), { replace: true })
          return
        }
      }

      if (!grant) {
        // A null grant with no error means the token stopped resolving between
        // the read above and here -- the owner revoking mid-open. An error
        // means something else went wrong, and the difference matters to
        // whoever has to fix it.
        setReason(failure)
        setState(failure ? 'access-failed' : 'unavailable')
        return
      }

      navigate(sharedNoteHref(shared.slug, shared.id), { replace: true })
    })()

    return () => {
      cancelled = true
    }
  }, [token, user, authLoading, navigate, attempt])

  if (state === 'working') return <LoadingScreen label="Opening the note" />

  return (
    <div className="grid min-h-full place-items-center px-6">
      <div className="max-w-sm text-center">
        <AppDocIcon className="mx-auto h-10 w-[32px] text-ink" />

        {state === 'signed-out' ? (
          <>
            <h1 className="mt-4 text-lg font-medium text-ink">
              {title ? `“${title}” was shared with you` : 'A note was shared with you'}
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              Sign in to open it. It will appear under Shared with me, alongside
              your own notes.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Link
                to={loginHref(`/shared/${token ?? ''}`)}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Sign in
              </Link>
              <Link
                to={signUpHref(`/shared/${token ?? ''}`)}
                className="rounded border border-line-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-surface-hover"
              >
                Create account
              </Link>
            </div>
          </>
        ) : state === 'access-failed' ? (
          <>
            <h1 className="mt-4 text-lg font-medium text-ink">
              Couldn’t open this note
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              The link is valid, but access could not be recorded. This is a
              fault on our side rather than a problem with the link.
            </p>
            {reason && (
              <p className="mt-2 whitespace-pre-wrap break-words rounded border border-line bg-surface-backdrop px-3 py-2 text-left font-mono text-xs text-ink-muted">
                {reason}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setReason(null)
                setState('working')
                setAttempt((n) => n + 1)
              }}
              className="mt-6 rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-medium text-ink">This link isn’t available</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Nothing here matches this link. Ask whoever shared it to check that
              sharing is still switched on, and that the link has not been reset
              since they sent it — resetting a link replaces it, and the old one
              stops working.
            </p>
            <Link
              to="/classes"
              className="mt-6 inline-block rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Go to my notes
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

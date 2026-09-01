import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppDocIcon } from '../editor/DocsIcons'
import { LoadingScreen } from '../components/LoadingScreen'
import { useAuth } from '../contexts/AuthContext'
import { fetchSharedDocument, redeemShareToken } from '../services/sharing'
import { loginHref, signUpHref } from '../lib/returnTo'
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
  const [state, setState] = useState<'working' | 'signed-out' | 'unavailable'>('working')
  const [title, setTitle] = useState<string>('')

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
      const grant = await redeemShareToken(token).catch((caught) => {
        console.error('[SharedLinkPage] could not record access:', caught)
        return null
      })

      if (cancelled) return

      if (!grant) {
        setState('unavailable')
        return
      }

      navigate(sharedNoteHref(shared.slug, shared.id), { replace: true })
    })()

    return () => {
      cancelled = true
    }
  }, [token, user, authLoading, navigate])

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
        ) : (
          <>
            <h1 className="mt-4 text-lg font-medium text-ink">This link isn’t available</h1>
            <p className="mt-2 text-sm text-ink-muted">
              The link may be wrong, or sharing may have been turned off for this
              note.
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

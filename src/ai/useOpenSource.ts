import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { fetchDocument } from '../services/documents'
import { fetchClass } from '../services/classes'
import { noteHref } from '../lib/noteRef'
import type { AiSource } from '../types/ai'

/**
 * Opens a note the assistant cited.
 *
 * The citation carries an id and a title, and nothing else -- deliberately.
 * The route needs a class slug and a note slug too, and asking the model to
 * carry those would be three more fields it could get wrong, on the one
 * feature whose entire value is being checkable. So the id is the only thing
 * taken from the model, it is validated as a uuid before it ever reaches here,
 * and everything else is looked up.
 *
 * That lookup is also the authorisation. `fetchDocument` is scoped to the
 * caller and RLS refuses anything else, so a cited id belonging to somebody
 * else resolves to nothing rather than to a note -- a fabricated citation
 * fails closed instead of opening a stranger's work.
 */
export function useOpenSource(): {
  openSource: (source: AiSource) => void
  sourceError: string | null
  clearSourceError: () => void
} {
  const { user } = useAuth()
  // Read out before the callback closes over it: depending on `user?.id`
  // while the compiler infers `user` is a mismatch it refuses to optimise.
  const userId = user?.id ?? null
  const navigate = useNavigate()
  const [sourceError, setSourceError] = useState<string | null>(null)

  const openSource = useCallback(
    (source: AiSource) => {
      setSourceError(null)

      void (async () => {
        try {
          const document = await fetchDocument(userId, source.documentId)
          if (!document) {
            // The honest reading of a citation that resolves to nothing: the
            // note is not there, whether because it was deleted or because the
            // model named an id that never existed.
            setSourceError(`“${source.title}” could not be found in your notes.`)
            return
          }

          const klass = document.class_id
            ? await fetchClass(userId, document.class_id)
            : null

          navigate(noteHref(klass?.slug ?? '', document.slug, document.id))
        } catch (caught) {
          console.error('[useOpenSource] could not open a cited note:', caught)
          setSourceError(`“${source.title}” could not be opened just now.`)
        }
      })()
    },
    [userId, navigate],
  )

  return {
    openSource,
    sourceError,
    clearSourceError: useCallback(() => setSourceError(null), []),
  }
}

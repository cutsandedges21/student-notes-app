import { useCallback, useState } from 'react'
import { generateJSON } from '@tiptap/core'
import { useAuth } from '../contexts/AuthContext'
import { createDocument, saveDocument } from '../services/documents'
import { fetchClass } from '../services/classes'
import { markdownToHtml } from '../lib/markdown'
import { editorExtensions } from '../editor/extensions'
import { noteHref } from '../lib/noteRef'
import { describeDataError } from '../lib/dataErrors'
import type { AiProposedAction } from '../types/ai'

/**
 * Carrying out something the assistant offered.
 *
 * The other half of the boundary the tool layer draws. Tools run on the server
 * the moment the model asks for one, so they are read-only; anything that
 * makes or changes the student's work is proposed instead, and lands here only
 * because somebody pressed a button.
 *
 * Which is also why creating a note is done from the browser rather than in
 * the edge function. `createDocument` already owns slug generation, uniqueness
 * within the class, and the guest path -- a second implementation in Deno
 * would be a second set of rules to disagree with, which is how this codebase
 * got a link prompt that meant different things in the toolbar and the menu.
 */

export interface ProposedActionRunner {
  /** The action currently being carried out, so its card can show progress. */
  running: AiProposedAction | null
  error: string | null
  /** The note that was just made, offered as somewhere to go. */
  created: { title: string; href: string } | null
  run: (action: AiProposedAction, classId: string) => void
  dismissError: () => void
  dismissCreated: () => void
}

export function useProposedActions(): ProposedActionRunner {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [running, setRunning] = useState<AiProposedAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ title: string; href: string } | null>(null)

  const run = useCallback(
    (action: AiProposedAction, classId: string) => {
      if (!userId) {
        setError('Sign in to let the assistant make notes for you.')
        return
      }

      setRunning(action)
      setError(null)

      void (async () => {
        try {
          // Created first, then written to. The two-step is `createDocument`'s
          // existing shape -- it reserves a unique slug within the class --
          // and reusing it is the point.
          const document = await createDocument(userId, classId, action.title)

          const result = await saveDocument(userId, {
            documentId: document.id,
            title: action.title,
            /*
             * Through the editor's own extension set, so the note is parsed
             * against the schema it will be opened with. Anything the schema
             * does not know is dropped here, where it is a shorter note,
             * rather than on first open, where it looks like data loss.
             */
            content: generateJSON(markdownToHtml(action.content), editorExtensions),
            expectedVersion: document.version,
          })

          if (result.status !== 'saved') {
            /*
             * The row exists and its body did not land. Said plainly rather
             * than swallowed: the student has an empty note in their class
             * either way, and finding it unexplained later is worse than being
             * told now.
             */
            setError(
              `“${action.title}” was created but its contents did not save. Try asking again.`,
            )
            return
          }

          const klass = await fetchClass(userId, classId)
          setCreated({
            title: action.title,
            href: noteHref(klass?.slug ?? '', document.slug, document.id),
          })
        } catch (caught) {
          console.error('[useProposedActions] could not create a note:', caught)
          setError(describeDataError(caught))
        } finally {
          setRunning(null)
        }
      })()
    },
    [userId],
  )

  return {
    running,
    error,
    created,
    run,
    dismissError: useCallback(() => setError(null), []),
    // Opening the new note is left to the caller, through `created.href`, so
    // it is the student's decision rather than something that happens to them
    // in the middle of a conversation.
    dismissCreated: useCallback(() => setCreated(null), []),
  }
}

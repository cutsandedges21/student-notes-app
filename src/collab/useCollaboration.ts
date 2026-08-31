import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Schema } from '@tiptap/pm/model'
import { getSchema, type JSONContent } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'
import { isSupabaseConfigured, supabase as defaultClient } from '../lib/supabase'
import { YjsProvider, type ProviderUser } from './YjsProvider'
import { SupabaseTransport } from './supabaseTransport'
import type { CollabTransport } from './transport'
import { COMPACT_THRESHOLD, compactYDoc, createYPersister, loadYDoc } from './persistence'
import { loadOrSeedYDoc } from './seed'

/**
 * The lifecycle of one collaborative editing session.
 *
 * Everything below the hook -- the provider, the transport, the update log --
 * already exists and is tested. This is the part that decides *whether* any of
 * it runs, and that decision is a correctness boundary rather than a feature
 * flag:
 *
 * - **Guest mode has no backend.** Signed out, there is no Supabase client, no
 *   Realtime, and notes live in this browser's localStorage. Collaboration is
 *   not merely unnecessary there, it is impossible, and the hook must be inert
 *   rather than half-started. `userId === null` is the guard, and the absence
 *   of a configured client is a second one behind it.
 * - **A private note does not need a CRDT.** Turning every document into one
 *   would migrate every note in the project into a storage format it never
 *   asked for, and the failure mode of that migration is duplicated content.
 *   Collaboration engages only where two people can genuinely be editing at
 *   once: a note shared for editing.
 *
 * When either condition fails the hook reports `status: 'off'` and the existing
 * single-writer autosave path continues completely unchanged.
 */

export type CollaborationStatus =
  /** Not collaborating: signed out, not shared for editing, or no backend. */
  | 'off'
  /** Deciding, loading or seeding. Callers hold the editor back; see `pending`. */
  | 'starting'
  | 'connected'
  /** The channel dropped. Edits are local-only until it returns. */
  | 'disconnected'
  /** Setup failed. The caller falls back to the single-writer path. */
  | 'error'

export interface UseCollaborationOptions {
  /** Null until the note has been looked up. */
  documentId: string | null
  /** Null while signed out. Guest mode never collaborates. */
  userId: string | null
  /** Shown on the caret label and in the presence bar. */
  displayName: string
  /**
   * The note is shared for editing: its owner set `share_mode = 'edit'`, or
   * this reader arrived through an edit share link and redeemed it.
   */
  sharedForEditing: boolean
  /**
   * What `documents.content` holds right now, for the first collaborative open.
   *
   * Read once, at seed time. Deliberately not a dependency of the session: a
   * change to it is an edit, and an edit must not tear down the session that
   * produced it.
   */
  content: JSONContent
  /** Injected by tests. `null` disables collaboration outright. */
  client?: SupabaseClient | null
  /** Injected by tests, so two sessions can be wired together in memory. */
  createTransport?: (documentId: string) => CollabTransport
  /** Injected by tests. Defaults to the editor's own schema. */
  schema?: Schema
  /** Unique per tab, not per user. Injected by tests for determinism. */
  clientId?: string
  /**
   * Log length that triggers compaction. Injected by tests.
   *
   * The real value is 200, which no test is going to reach a keystroke at a
   * time. Left injectable so the flush-reread-compact sequence is exercised
   * rather than merely typechecked -- it is the one path here that deletes
   * rows, and untested delete code is not something to ship.
   */
  compactThreshold?: number
}

export interface CollaborationSession {
  status: CollaborationStatus
  /**
   * True while the session is still being established.
   *
   * Callers must not show the editor yet. Opening it single-writer and then
   * swapping to the CRDT loses whatever was typed in between: those keystrokes
   * went into a document that is about to be replaced by one seeded from the
   * content as it was read.
   */
  pending: boolean
  /** True once the editor should be driven by Yjs. */
  active: boolean
  ydoc: Y.Doc | null
  provider: YjsProvider | null
  user: ProviderUser | null
  /** Live channel. False means edits are not reaching anyone else. */
  connected: boolean
  /** Writes anything still queued. Safe to call when not collaborating. */
  flush: () => Promise<void>
}

/**
 * The session as held in state, tagged with what it describes.
 *
 * The tag is why `pending` can be answered during render rather than after the
 * effect has run. Without it there is one committed render in which the note is
 * collaborative but the state still says 'off', and the caller opens a
 * single-writer editor for a frame before tearing it down again.
 */
interface SessionState {
  /** `<documentId>:<userId>`, or null when collaboration is off. */
  key: string | null
  status: CollaborationStatus
  ydoc: Y.Doc | null
  provider: YjsProvider | null
  user: ProviderUser | null
  connected: boolean
}

const OFF: SessionState = {
  key: null,
  status: 'off',
  ydoc: null,
  provider: null,
  user: null,
  connected: false,
}

/**
 * Cursor colours.
 *
 * Picked by hashing the user id rather than at random, so a collaborator keeps
 * the same colour across reloads, across tabs and on everyone else's screen.
 * A colour that changes on every reload is not an identity, and identity is the
 * entire job of a caret colour.
 *
 * Chosen to stay legible as a caret line against white and to carry white text
 * as an avatar background.
 */
const CARET_COLORS = [
  '#1a73e8',
  '#0f6b4f',
  '#c5221f',
  '#a8500f',
  '#7627bb',
  '#0b6e75',
  '#b3096f',
  '#3b6c1f',
]

/** FNV-1a. Small, stable, and not a security boundary. */
function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** The colour for a user id. Stable for as long as the id is. */
export function userColor(userId: string): string {
  return CARET_COLORS[hashString(userId) % CARET_COLORS.length]
}

/** One id per tab: the same person in two tabs is two peers with two carets. */
function newClientId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `client-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

/**
 * Watches connection state without stealing the provider's handler.
 *
 * `CollabTransport.onConnectionChange` holds one handler, and the provider
 * needs it -- that callback is what makes it re-sync after a dropped channel.
 * Wrapping rather than replacing lets the UI see the same signal, which is what
 * lets it say "not syncing" instead of quietly accepting keystrokes that are
 * going nowhere.
 */
function observeConnection(
  inner: CollabTransport,
  onChange: (connected: boolean) => void,
): CollabTransport {
  return {
    connect: (onMessage) => inner.connect(onMessage),
    send: (message) => inner.send(message),
    disconnect: () => inner.disconnect(),
    onConnectionChange: (handler) => {
      inner.onConnectionChange((connected) => {
        onChange(connected)
        handler(connected)
      })
    },
  }
}

/** Built once: compiling a ProseMirror schema is not free. */
let cachedSchema: Schema | null = null
function editorSchema(): Schema {
  cachedSchema ??= getSchema(editorExtensions)
  return cachedSchema
}

export function useCollaboration(options: UseCollaborationOptions): CollaborationSession {
  const {
    documentId,
    userId,
    displayName,
    sharedForEditing,
    content,
    client: injectedClient,
    createTransport,
    schema,
    clientId: injectedClientId,
    compactThreshold = COMPACT_THRESHOLD,
  } = options

  /*
   * `undefined` means "use the app's client"; an explicit `null` means "there
   * is no backend", which is how a test asserts that guest mode cannot start a
   * session even if every other condition were somehow met.
   */
  const client =
    injectedClient === undefined
      ? isSupabaseConfigured
        ? defaultClient
        : null
      : injectedClient

  const enabled = Boolean(documentId && userId && sharedForEditing && client)
  /** What a session would have to describe to be the one the caller wants. */
  const wanted = enabled ? `${documentId}:${userId}` : null

  const [session, setSession] = useState<SessionState>(OFF)

  /*
   * Read through refs inside the effect rather than listed as dependencies.
   *
   * `content` changes on every keystroke and `displayName` on every profile
   * load; either in the dependency array would tear the session down and
   * rebuild it mid-sentence, dropping the connection and everyone's carets.
   * Both are only consulted once, at startup.
   */
  const contentRef = useRef(content)
  contentRef.current = content
  const displayNameRef = useRef(displayName)
  displayNameRef.current = displayName

  const persisterRef = useRef<{ flush: () => Promise<void> } | null>(null)
  const flush = useCallback(() => persisterRef.current?.flush() ?? Promise.resolve(), [])

  const providerUser = useMemo<ProviderUser | null>(() => {
    if (!userId) return null
    return { id: userId, name: displayName || 'Someone', color: userColor(userId) }
  }, [userId, displayName])

  useEffect(() => {
    if (!enabled || !client || !documentId || !userId) {
      persisterRef.current = null
      setSession(OFF)
      return
    }

    let cancelled = false
    const doc = new Y.Doc()
    let provider: YjsProvider | null = null
    let persister: ReturnType<typeof createYPersister> | null = null

    const user: ProviderUser = {
      id: userId,
      name: displayNameRef.current || 'Someone',
      color: userColor(userId),
    }

    setSession({ ...OFF, key: wanted, status: 'starting', user })

    const setConnected = (connected: boolean) => {
      if (cancelled) return
      setSession((current) =>
        current.provider === null
          ? current
          : { ...current, connected, status: connected ? 'connected' : 'disconnected' },
      )
    }

    void (async () => {
      try {
        const loaded = await loadOrSeedYDoc(
          client,
          documentId,
          contentRef.current,
          schema ?? editorSchema(),
        )
        if (cancelled) return

        persister = createYPersister(client, documentId, userId)
        persisterRef.current = persister

        /*
         * Compaction bookkeeping.
         *
         * `updateCount` starts at however many log rows were replayed on load,
         * because the threshold is about the length of the log rather than
         * about this session's share of it -- a note opened at 199 rows should
         * compact on the next keystroke, not after another two hundred.
         */
        let updateCount = loaded.updateCount
        let compacting = false

        const compactIfNeeded = async () => {
          if (compacting || cancelled || updateCount <= compactThreshold) return
          compacting = true
          try {
            // Flush first: rows still sitting in the debounce queue would
            // otherwise be excluded from the snapshot and then replayed on top
            // of it, which is harmless but pointless.
            await persister?.flush()
            /*
             * Re-read to learn the log's current high-water mark. The id to
             * delete through is not something this client can know from its own
             * writes -- ids are assigned by the database, and other people have
             * been appending too. Anything inserted after this read has a higher
             * id, survives the delete, and is replayed on top of the snapshot.
             */
            const fresh = await loadYDoc(client, documentId)
            if (cancelled || !provider) return
            if (fresh.update) provider.applyRemote(fresh.update)
            await compactYDoc(client, documentId, doc, fresh.throughId)
            updateCount = 0
          } catch (caught) {
            // Compaction is an optimisation. Failing it leaves a longer log and
            // a slower load, not a lost or corrupted document.
            console.error('[collab] compaction failed:', caught)
          } finally {
            compacting = false
          }
        }

        const transport = observeConnection(
          createTransport ? createTransport(documentId) : new SupabaseTransport(client, documentId),
          setConnected,
        )

        provider = new YjsProvider({
          doc,
          transport,
          clientId: injectedClientId ?? newClientId(),
          user,
          onLocalUpdate: (update) => {
            persister?.push(update)
            updateCount += 1
            void compactIfNeeded()
          },
        })

        /*
         * Stored state lands before the channel opens, and through the provider
         * so it is tagged with the provider as its origin. Applying it after
         * connecting would rebroadcast the entire note to everyone already
         * editing it; applying it untagged would rebroadcast it as though it
         * had just been typed.
         */
        if (loaded.update) provider.applyRemote(loaded.update)

        await provider.connect()

        if (cancelled) {
          await provider.destroy()
          provider = null
          return
        }

        setSession({
          key: wanted,
          status: 'connected',
          ydoc: doc,
          provider,
          user,
          connected: provider.isConnected,
        })
      } catch (caught) {
        console.error('[collab] failed to start a collaborative session:', caught)
        if (cancelled) return
        /*
         * Falling back rather than failing hard.
         *
         * An errored session is not active, which puts the caller back on the
         * single-writer autosave path -- and that path still works, because
         * `documents.content` is real storage rather than a cache. A note that
         * will not open is a worse outcome than a note that opens without live
         * cursors. The key is still recorded, so the caller stops waiting.
         */
        persisterRef.current = null
        setSession({ ...OFF, key: wanted, status: 'error', user })
      }
    })()

    return () => {
      cancelled = true
      persisterRef.current = null

      /*
       * Teardown is asynchronous and the effect's cleanup is not, so the work
       * is started and not awaited. The order matters more than the timing:
       * pending updates are written before the provider announces its
       * departure and releases the channel, because an update that never
       * reaches storage is lost for good -- the transport has no replay either.
       */
      void (async () => {
        try {
          await persister?.flush()
        } catch (caught) {
          console.error('[collab] failed to flush on teardown:', caught)
        }
        await provider?.destroy()
        doc.destroy()
      })()
    }
    // `content` and `displayName` are read through refs on purpose; see above.
    // `wanted` is derived from documentId and userId, which are both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, documentId, userId, enabled, createTransport, schema, injectedClientId])

  // Keeps the caret label current when the profile loads after the session has
  // started, without restarting the session to do it.
  useEffect(() => {
    if (!session.provider || !providerUser) return
    session.provider.awareness.setLocalStateField('user', providerUser)
  }, [session.provider, providerUser])

  /*
   * The public view, reconciled against what the caller is currently asking
   * for.
   *
   * `session` is written by an effect and so is always one commit behind a
   * change of note. Comparing its key with `wanted` here is what makes
   * `pending` true from the very first render of a collaborative note -- and
   * what stops a session belonging to the previous note being reported as this
   * one's for a frame.
   */
  const matched = session.key !== null && session.key === wanted

  return useMemo<CollaborationSession>(
    () => ({
      status: matched ? session.status : wanted === null ? 'off' : 'starting',
      pending: wanted !== null && (!matched || session.status === 'starting'),
      active: matched && (session.status === 'connected' || session.status === 'disconnected'),
      ydoc: matched ? session.ydoc : null,
      provider: matched ? session.provider : null,
      user: matched ? session.user : null,
      connected: matched && session.connected,
      flush,
    }),
    [matched, wanted, session, flush],
  )
}

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { CollabMessage, CollabTransport } from './transport'

/**
 * The real transport: one Supabase Realtime channel per document.
 *
 * `private: true` is not optional. It makes Realtime authorise the
 * subscription against the RLS policies on `realtime.messages`, which is what
 * stops someone joining a note's channel -- and reading every keystroke typed
 * into it -- by guessing a document id. Without it the channel is open to any
 * authenticated user in the project.
 *
 * `self: false` because a client applies its own edits locally the instant it
 * makes them; hearing them back is wasted traffic against a project-wide
 * message budget that is shared with every other document open anywhere.
 */

/** Topic for a document's channel. Parsed by realtime_document_id() in SQL. */
export function documentTopic(documentId: string): string {
  return `doc:${documentId}`
}

const EVENT = 'y'

export class SupabaseTransport implements CollabTransport {
  private readonly supabase: SupabaseClient
  private readonly documentId: string
  private channel: RealtimeChannel | null = null
  private connectionHandler: ((connected: boolean) => void) | null = null

  constructor(supabase: SupabaseClient, documentId: string) {
    this.supabase = supabase
    this.documentId = documentId
  }

  async connect(onMessage: (message: CollabMessage) => void): Promise<void> {
    const channel = this.supabase.channel(documentTopic(this.documentId), {
      config: { broadcast: { self: false }, private: true },
    })

    channel.on('broadcast', { event: EVENT }, ({ payload }) => {
      onMessage(payload as CollabMessage)
    })

    this.channel = channel

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          this.connectionHandler?.(true)
          resolve()
          return
        }

        /*
         * A dropped channel is reported so the provider can re-sync when it
         * comes back. It must not be treated as fatal: Realtime reconnects on
         * its own, and the sync exchange is designed precisely so that a gap
         * in delivery is recoverable rather than terminal.
         */
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.connectionHandler?.(false)
          // Only the first subscribe attempt can reject; later failures are
          // reconnects, and rejecting a settled promise is a no-op anyway.
          if (error) reject(error)
        }
      })
    })
  }

  send(message: CollabMessage): void {
    // Dropping while disconnected is correct rather than lossy: the update is
    // already in the local Yjs document, and the sync on reconnect is what
    // gets it to everyone else.
    void this.channel?.send({ type: 'broadcast', event: EVENT, payload: message })
  }

  async disconnect(): Promise<void> {
    if (!this.channel) return
    const channel = this.channel
    this.channel = null
    await this.supabase.removeChannel(channel)
  }

  onConnectionChange(handler: (connected: boolean) => void): void {
    this.connectionHandler = handler
  }
}

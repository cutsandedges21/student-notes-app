import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { fromBase64, toBase64 } from './encoding'
import type { CollabMessage, CollabTransport } from './transport'

/**
 * Keeps a Yjs document in step with everyone else editing it.
 *
 * There is no maintained Yjs provider for Supabase -- `y-supabase` has been an
 * abandoned alpha since early 2023 -- and the deployment has nowhere to run
 * Hocuspocus, so this is written rather than installed. It is deliberately
 * small, and deliberately not tied to Supabase: it talks to a `CollabTransport`
 * so that two providers can be wired together in memory and actually asserted
 * to converge.
 *
 * ## The protocol, and why it is not just "broadcast every change"
 *
 * Realtime broadcast is fire-and-forget. There is no delivery guarantee, no
 * ordering guarantee across reconnects, and no replay. A client that drops off
 * for two seconds misses whatever was said and has no way to notice -- and in
 * a CRDT, silently missing an update is silently diverging. Two people would
 * see different documents, each convinced they were up to date.
 *
 * So every (re)connection begins by asking. The provider broadcasts its state
 * vector -- a compact description of what it already has -- and peers reply
 * with exactly the diff it lacks. That single exchange handles first join,
 * reconnect after a dropped websocket, and a laptop reopened an hour later,
 * because all three are the same question: what have I missed?
 *
 * Yjs updates are commutative and idempotent, so a duplicate reply or an
 * out-of-order one costs nothing. That is what makes an unreliable transport
 * acceptable here, and it is why the sync exchange is the only part that has
 * to be right.
 *
 * ## Origins
 *
 * Every applied remote update is tagged with this provider as its origin.
 * Without that the document's own update event would fire for text that just
 * arrived from a peer, and the provider would broadcast it straight back --
 * an echo that never settles.
 */

/**
 * Size of a Yjs update that carries no changes.
 *
 * An empty struct list and an empty delete set, one byte each. Verified by a
 * test rather than taken on faith, since it is an encoding detail.
 */
const EMPTY_UPDATE_BYTES = 2

export interface ProviderUser {
  id: string
  name: string
  /** Cursor colour. Stable per user so a collaborator keeps their identity. */
  color: string
}

export interface YjsProviderOptions {
  doc: Y.Doc
  transport: CollabTransport
  /** Unique per tab, not per user: one person in two tabs is two peers. */
  clientId: string
  user: ProviderUser
  /**
   * Called with every locally-produced update, for persistence.
   *
   * Separate from the transport because durability and delivery are different
   * problems: a message reaching the other person's screen is not the same as
   * it surviving both of them closing the tab.
   */
  onLocalUpdate?: (update: Uint8Array) => void
}

export class YjsProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  private readonly transport: CollabTransport
  private readonly clientId: string
  private readonly onLocalUpdate?: (update: Uint8Array) => void
  private connected = false
  private destroyed = false

  constructor({ doc, transport, clientId, user, onLocalUpdate }: YjsProviderOptions) {
    this.doc = doc
    this.transport = transport
    this.clientId = clientId
    this.onLocalUpdate = onLocalUpdate

    this.awareness = new Awareness(doc)
    this.awareness.setLocalStateField('user', user)

    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
  }

  async connect(): Promise<void> {
    this.transport.onConnectionChange((connected) => {
      this.connected = connected
      // Every (re)join asks what it missed. See the class comment: a silent
      // gap in a CRDT is a silent divergence.
      if (connected) this.requestSync()
    })

    await this.transport.connect(this.handleMessage)
    this.connected = true
    this.requestSync()
  }

  /** True once the transport reports a live channel. */
  get isConnected(): boolean {
    return this.connected
  }

  /**
   * Applies an update that came from storage rather than a peer.
   *
   * Tagged with this provider as origin so loading a document does not
   * rebroadcast every byte of it back to everyone already editing.
   */
  applyRemote(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, this)
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.doc.off('update', this.handleDocUpdate)

    /*
     * Announce the departure *before* detaching the awareness handler.
     *
     * Removing the state fires an awareness update, and that update is the
     * message telling everyone else the cursor has gone. Unsubscribing first
     * -- which is the obvious order, and what this did until a test caught it
     * -- means nobody is listening when it fires, so the caret stays on every
     * other screen: a ghost implying someone is still in the document.
     */
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'provider destroyed')
    this.awareness.off('update', this.handleAwarenessUpdate)
    this.awareness.destroy()
    await this.transport.disconnect()
  }

  private requestSync(): void {
    this.transport.send({
      type: 'sync-request',
      from: this.clientId,
      stateVector: toBase64(Y.encodeStateVector(this.doc)),
    })
    this.announceAwareness()
  }

  /**
   * Says who we are, unprompted.
   *
   * Arriving is not only about catching up on the document -- the people
   * already here have to be told someone joined. Asking for a sync tells them
   * nothing about us: they answer with their own state and carry on, so
   * without this the newcomer sees everyone while remaining invisible to them,
   * and a collaborator would appear to be editing alone.
   *
   * Sent on reconnect too. Peers time out awareness states they stop hearing
   * about, so someone returning from a dropped connection has to reintroduce
   * themselves rather than assume they are still on the roster.
   */
  private announceAwareness(): void {
    const states = [...this.awareness.getStates().keys()]
    if (states.length === 0) return

    this.transport.send({
      type: 'awareness',
      from: this.clientId,
      update: toBase64(encodeAwarenessUpdate(this.awareness, states)),
    })
  }

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Anything this provider applied came from elsewhere; sending it back is
    // an echo. Only genuinely local edits go out.
    if (origin === this) return

    this.onLocalUpdate?.(update)
    this.transport.send({
      type: 'update',
      from: this.clientId,
      update: toBase64(update),
    })
  }

  private readonly handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return

    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return

    this.transport.send({
      type: 'awareness',
      from: this.clientId,
      update: toBase64(encodeAwarenessUpdate(this.awareness, changed)),
    })
  }

  private readonly handleMessage = (message: CollabMessage) => {
    if (this.destroyed) return
    // A transport that echoes to the sender would otherwise have us answering
    // our own sync requests.
    if (message.from === this.clientId) return

    switch (message.type) {
      case 'update':
        Y.applyUpdate(this.doc, fromBase64(message.update), this)
        break

      case 'sync-request': {
        // Reply with precisely what they lack. `encodeStateAsUpdate` against
        // their state vector is a diff, not the document, so a peer joining a
        // long note does not cost everyone a full copy of it.
        const diff = Y.encodeStateAsUpdate(this.doc, fromBase64(message.stateVector))
        this.transport.send({
          type: 'sync-reply',
          from: this.clientId,
          to: message.from,
          update: toBase64(diff),
          // Our own state vector rides along, so they can send us what *we*
          // are missing. Only the reconnecting side knows to ask; without
          // this, anything they wrote while away would never reach us.
          stateVector: toBase64(Y.encodeStateVector(this.doc)),
        })

        // A new arrival should see who is already here.
        this.transport.send({
          type: 'awareness',
          from: this.clientId,
          update: toBase64(
            encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]),
          ),
        })
        break
      }

      case 'sync-reply': {
        // Addressed messages still reach everyone; ignore other people's mail.
        if (message.to !== this.clientId) return
        Y.applyUpdate(this.doc, fromBase64(message.update), this)

        // Close the loop: send back whatever they lack. A plain `update`
        // rather than another sync-request, so this terminates here instead of
        // the two of us politely re-syncing at each other indefinitely.
        const theirs = Y.encodeStateAsUpdate(this.doc, fromBase64(message.stateVector))
        // An update carrying nothing encodes to two bytes -- an empty struct
        // list and an empty delete set. Skipping those keeps a quiet document
        // quiet, which matters against Realtime's project-wide message budget.
        if (theirs.length > EMPTY_UPDATE_BYTES) {
          this.transport.send({
            type: 'update',
            from: this.clientId,
            update: toBase64(theirs),
          })
        }
        break
      }

      case 'awareness':
        applyAwarenessUpdate(this.awareness, fromBase64(message.update), this)
        break
    }
  }
}

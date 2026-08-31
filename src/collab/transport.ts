/**
 * What the collaboration provider needs from a network, and nothing more.
 *
 * The provider is written against this rather than against Supabase directly,
 * for one reason that matters more than tidiness: it makes convergence
 * testable. Two providers wired to an in-memory transport are two real Yjs
 * documents exchanging real updates, so "do these two people end up with the
 * same text" becomes an assertion rather than a hope. Testing that through a
 * live Realtime channel would be slow, flaky, and would not run in CI.
 */

/** Messages the provider exchanges. Payloads are base64 (see encoding.ts). */
export type CollabMessage =
  /**
   * "Here is what I have; send me what I am missing."
   *
   * Broadcast on join and on every reconnect. Realtime broadcast is
   * fire-and-forget with no replay, so a client that was disconnected for two
   * seconds has a hole in its history and no way to notice. Asking on every
   * (re)connect is what closes it -- the state vector says precisely what is
   * missing, so the answer is a diff rather than the whole document.
   */
  | { type: 'sync-request'; from: string; stateVector: string }
  /**
   * The diff a peer was missing, plus what the replier itself has.
   *
   * The state vector travels back for a reason that cost a test failure to
   * find: only the peer that reconnects knows to ask. The peer that stayed
   * online has no idea it missed anything, so if the reply carried only a
   * diff, edits made *during* a partition by the peer that was away would
   * never reach the one that stayed -- and the two would sit there diverged,
   * each believing it was current.
   *
   * Carrying the replier's state vector lets the requester answer in the same
   * breath. Two messages, no ping-pong: a reciprocal `sync-request` here would
   * have each side answering the other forever.
   */
  | { type: 'sync-reply'; from: string; to: string; update: string; stateVector: string }
  /** A local edit, for everyone. */
  | { type: 'update'; from: string; update: string }
  /** Cursor and selection, for everyone. */
  | { type: 'awareness'; from: string; update: string }

export interface CollabTransport {
  /** Begins delivering messages. Resolves once joined. */
  connect(onMessage: (message: CollabMessage) => void): Promise<void>
  send(message: CollabMessage): void
  /** Stops delivery and releases the underlying channel. */
  disconnect(): Promise<void>
  /**
   * Reports connection state changes.
   *
   * `true` means (re)joined, and the provider answers it by re-syncing --
   * anything that happened while it was away has to be asked for.
   */
  onConnectionChange(handler: (connected: boolean) => void): void
}

/**
 * An in-memory bus, for tests.
 *
 * Every transport attached to the same bus delivers to every other one, never
 * to itself -- matching Supabase broadcast with `self: false`.
 */
export class MemoryBus {
  private readonly members = new Set<MemoryTransport>()

  join(member: MemoryTransport): void {
    this.members.add(member)
  }

  leave(member: MemoryTransport): void {
    this.members.delete(member)
  }

  publish(from: MemoryTransport, message: CollabMessage): void {
    for (const member of this.members) {
      if (member !== from) member.deliver(message)
    }
  }
}

export class MemoryTransport implements CollabTransport {
  private handler: ((message: CollabMessage) => void) | null = null
  private connectionHandler: ((connected: boolean) => void) | null = null
  private connected = false
  /** Set while "offline"; messages sent to a partitioned member are dropped. */
  private partitioned = false

  // Declared explicitly rather than as a constructor parameter property: the
  // project builds with `erasableSyntaxOnly`, which disallows the shorthand.
  private readonly bus: MemoryBus

  constructor(bus: MemoryBus) {
    this.bus = bus
  }

  async connect(onMessage: (message: CollabMessage) => void): Promise<void> {
    this.handler = onMessage
    this.bus.join(this)
    this.connected = true
    this.connectionHandler?.(true)
  }

  send(message: CollabMessage): void {
    if (!this.connected || this.partitioned) return
    this.bus.publish(this, message)
  }

  async disconnect(): Promise<void> {
    this.bus.leave(this)
    this.connected = false
    this.handler = null
  }

  onConnectionChange(handler: (connected: boolean) => void): void {
    this.connectionHandler = handler
  }

  deliver(message: CollabMessage): void {
    if (this.partitioned) return
    this.handler?.(message)
  }

  /**
   * Simulates losing the network without a clean disconnect.
   *
   * The interesting case: messages sent while away are simply gone, because
   * broadcast has no replay. Rejoining must therefore re-sync rather than
   * assume it can carry on, and that is what these tests are for.
   */
  setPartitioned(value: boolean): void {
    const wasPartitioned = this.partitioned
    this.partitioned = value
    if (wasPartitioned && !value) this.connectionHandler?.(true)
    if (!wasPartitioned && value) this.connectionHandler?.(false)
  }
}

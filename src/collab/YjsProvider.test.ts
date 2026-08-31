import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { YjsProvider, type ProviderUser } from './YjsProvider'
import { MemoryBus, MemoryTransport } from './transport'

/*
 * Convergence, asserted rather than assumed.
 *
 * The claim collaborative editing makes is that two people typing at once end
 * up with the same document and neither loses work. That is exactly what the
 * version-counter mechanism this replaces could not do -- it refused the
 * second save and, before Phase 0, quietly threw that person's text away.
 *
 * These are real Yjs documents exchanging real updates through an in-memory
 * bus, so the merges are the ones that would happen over a network. What the
 * bus is not is unreliable in the same ways a network is; the partition tests
 * cover the failure that matters most -- messages sent while a peer is away
 * are simply gone, because Realtime broadcast has no replay.
 */

const user = (name: string): ProviderUser => ({ id: name, name, color: '#000' })

interface Peer {
  doc: Y.Doc
  provider: YjsProvider
  transport: MemoryTransport
  text: () => string
}

async function peer(bus: MemoryBus, name: string): Promise<Peer> {
  const doc = new Y.Doc()
  const transport = new MemoryTransport(bus)
  const provider = new YjsProvider({ doc, transport, clientId: name, user: user(name) })
  await provider.connect()
  return { doc, provider, transport, text: () => doc.getText('body').toString() }
}

/** Lets queued microtasks settle; the bus delivers synchronously. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('YjsProvider', () => {
  it('carries an edit from one peer to another', async () => {
    const bus = new MemoryBus()
    const a = await peer(bus, 'a')
    const b = await peer(bus, 'b')

    a.doc.getText('body').insert(0, 'Mitochondria')
    await settle()

    expect(b.text()).toBe('Mitochondria')
  })

  /*
   * The headline case. Two people typing into the same paragraph at the same
   * moment: both edits survive, and both documents agree on the result.
   */
  it('merges simultaneous edits without either being lost', async () => {
    const bus = new MemoryBus()
    const a = await peer(bus, 'a')
    const b = await peer(bus, 'b')

    a.doc.getText('body').insert(0, 'Photosynthesis. ')
    await settle()

    // Both type before either has seen the other.
    a.doc.getText('body').insert(a.doc.getText('body').length, 'From A.')
    b.doc.getText('body').insert(0, 'From B. ')
    await settle()

    expect(a.text()).toBe(b.text())
    expect(a.text()).toContain('From A.')
    expect(a.text()).toContain('From B.')
    expect(a.text()).toContain('Photosynthesis.')
  })

  it('gives a late joiner the document that already exists', async () => {
    const bus = new MemoryBus()
    const a = await peer(bus, 'a')
    a.doc.getText('body').insert(0, 'Written before anyone else arrived.')
    await settle()

    const b = await peer(bus, 'b')
    await settle()

    expect(b.text()).toBe('Written before anyone else arrived.')
  })

  it('converges three peers', async () => {
    const bus = new MemoryBus()
    const a = await peer(bus, 'a')
    const b = await peer(bus, 'b')
    const c = await peer(bus, 'c')

    a.doc.getText('body').insert(0, 'A')
    b.doc.getText('body').insert(0, 'B')
    c.doc.getText('body').insert(0, 'C')
    await settle()

    expect(a.text()).toBe(b.text())
    expect(b.text()).toBe(c.text())
    expect(a.text()).toHaveLength(3)
  })

  /*
   * The reason every connection begins with a sync request.
   *
   * Broadcast has no replay, so anything said while a peer is partitioned is
   * gone for good. Reconnecting has to ask what it missed; without that, the
   * two documents stay different forever and nothing reports a problem.
   */
  it('catches up on what it missed while disconnected', async () => {
    const bus = new MemoryBus()
    const a = await peer(bus, 'a')
    const b = await peer(bus, 'b')

    a.doc.getText('body').insert(0, 'Before. ')
    await settle()
    expect(b.text()).toBe('Before. ')

    b.transport.setPartitioned(true)
    a.doc.getText('body').insert(a.doc.getText('body').length, 'Said while B was away. ')
    await settle()

    // The message was broadcast into the void; B genuinely does not have it.
    expect(b.text()).toBe('Before. ')

    b.transport.setPartitioned(false)
    await settle()

    expect(b.text()).toBe(a.text())
    expect(b.text()).toContain('Said while B was away.')
  })

  it('merges edits made on both sides of a partition', async () => {
    const bus = new MemoryBus()
    const a = await peer(bus, 'a')
    const b = await peer(bus, 'b')

    a.doc.getText('body').insert(0, 'Shared start. ')
    await settle()

    b.transport.setPartitioned(true)
    a.doc.getText('body').insert(a.doc.getText('body').length, 'A kept working. ')
    b.doc.getText('body').insert(b.doc.getText('body').length, 'B kept working offline. ')
    await settle()

    b.transport.setPartitioned(false)
    await settle()

    expect(a.text()).toBe(b.text())
    expect(a.text()).toContain('A kept working.')
    expect(a.text()).toContain('B kept working offline.')
  })

  it('does not echo an update it received', async () => {
    const bus = new MemoryBus()
    const a = await peer(bus, 'a')
    const b = await peer(bus, 'b')

    const sent: string[] = []
    const original = b.transport.send.bind(b.transport)
    b.transport.send = (message) => {
      sent.push(message.type)
      original(message)
    }

    a.doc.getText('body').insert(0, 'One edit, from A.')
    await settle()

    // B applied it; B must not have broadcast it back out again.
    expect(b.text()).toBe('One edit, from A.')
    expect(sent).not.toContain('update')
  })

  it('reports local updates for persistence, and only local ones', async () => {
    const bus = new MemoryBus()
    const persisted: Uint8Array[] = []

    const docA = new Y.Doc()
    const a = new YjsProvider({
      doc: docA,
      transport: new MemoryTransport(bus),
      clientId: 'a',
      user: user('a'),
      onLocalUpdate: (update) => persisted.push(update),
    })
    await a.connect()

    const b = await peer(bus, 'b')

    docA.getText('body').insert(0, 'Local.')
    await settle()
    const afterLocal = persisted.length
    expect(afterLocal).toBeGreaterThan(0)

    b.doc.getText('body').insert(0, 'Remote.')
    await settle()

    // A applied B's edit but must not persist it as its own.
    expect(persisted).toHaveLength(afterLocal)
    await a.destroy()
  })

  it('does not rebroadcast a document loaded from storage', async () => {
    const bus = new MemoryBus()
    const a = await peer(bus, 'a')
    const b = await peer(bus, 'b')

    const seed = new Y.Doc()
    seed.getText('body').insert(0, 'Loaded from the database.')
    const stored = Y.encodeStateAsUpdate(seed)

    const sent: string[] = []
    const original = a.transport.send.bind(a.transport)
    a.transport.send = (message) => {
      sent.push(message.type)
      original(message)
    }

    a.provider.applyRemote(stored)
    await settle()

    expect(a.text()).toBe('Loaded from the database.')
    expect(sent).not.toContain('update')
    // And B is untouched, which is the contract: applyRemote is for seeding a
    // document from storage before connecting, not for publishing to peers.
    // Real callers load storage first and connect second, so the sync exchange
    // is what reconciles everyone -- not a broadcast of the whole document.
    expect(b.text()).toBe('')
  })

  describe('awareness', () => {
    it('shares who is present', async () => {
      const bus = new MemoryBus()
      const a = await peer(bus, 'a')
      const b = await peer(bus, 'b')
      await settle()

      const names = (peer: typeof a) =>
        [...peer.provider.awareness.getStates().values()].map(
          (state) => (state as { user?: ProviderUser }).user?.name,
        )

      // Both directions: a new arrival is told who is already here, and the
      // people already here are told about the arrival.
      expect(names(b)).toContain('a')
      expect(names(a)).toContain('b')
    })

    it('shares cursor position', async () => {
      const bus = new MemoryBus()
      const a = await peer(bus, 'a')
      const b = await peer(bus, 'b')

      a.provider.awareness.setLocalStateField('cursor', { anchor: 4, head: 9 })
      await settle()

      const states = [...b.provider.awareness.getStates().values()]
      const cursors = states.map((state) => (state as { cursor?: unknown }).cursor)
      expect(cursors).toContainEqual({ anchor: 4, head: 9 })
    })

    // A caret left behind by someone who closed their tab is worse than no
    // caret: it implies a person who is not there.
    it('removes a peer’s cursor when they leave', async () => {
      const bus = new MemoryBus()
      const a = await peer(bus, 'a')
      const b = await peer(bus, 'b')
      await settle()

      expect(b.provider.awareness.getStates().size).toBeGreaterThan(1)

      await a.provider.destroy()
      await settle()

      const names = [...b.provider.awareness.getStates().values()].map(
        (state) => (state as { user?: ProviderUser }).user?.name,
      )
      expect(names).not.toContain('a')
    })
  })

  it('stops sending once destroyed', async () => {
    const bus = new MemoryBus()
    const a = await peer(bus, 'a')
    const b = await peer(bus, 'b')

    await a.provider.destroy()
    b.doc.getText('body').insert(0, 'After A left.')
    await settle()

    expect(a.text()).toBe('')
  })
})

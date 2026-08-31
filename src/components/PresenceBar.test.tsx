import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { PresenceBar } from './PresenceBar'
import { YjsProvider, type ProviderUser } from '../collab/YjsProvider'
import { MemoryBus, MemoryTransport } from '../collab/transport'
import { userColor } from '../collab/useCollaboration'

/*
 * Driven by real providers over the in-memory bus rather than a hand-built
 * awareness map. The bar's job is to report what the collaboration layer
 * actually says, and the awareness protocol -- who is announced to whom, and
 * when -- is a real part of that. A fixture map would test the rendering and
 * quietly skip the question.
 */

const open: YjsProvider[] = []

async function join(bus: MemoryBus, user: ProviderUser): Promise<YjsProvider> {
  const provider = new YjsProvider({
    doc: new Y.Doc(),
    transport: new MemoryTransport(bus),
    clientId: `${user.id}:tab-${open.length}`,
    user,
  })
  await provider.connect()
  open.push(provider)
  return provider
}

const person = (id: string, name: string): ProviderUser => ({
  id,
  name,
  color: userColor(id),
})

/** jsdom reports inline colours as `rgb(r, g, b)`. */
function toRgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  // eslint-disable-next-line no-bitwise
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((provider) => provider.destroy()))
})

describe('PresenceBar', () => {
  it('shows the other people in the document', async () => {
    const bus = new MemoryBus()
    const me = await join(bus, person('user-a', 'Ada Lovelace'))
    await join(bus, person('user-b', 'Grace Hopper'))

    render(<PresenceBar awareness={me.awareness} selfId="user-a" connected />)

    expect(screen.getByRole('list', { name: 'People editing this note' })).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Grace Hopper is editing this note' }),
    ).toBeInTheDocument()
    expect(screen.getByTitle('Grace Hopper')).toHaveTextContent('GH')
  })

  // Being told you are in the document you are typing in is not information,
  // and it reads as a second person in the room.
  it('does not show the reader to themselves', async () => {
    const bus = new MemoryBus()
    const me = await join(bus, person('user-a', 'Ada Lovelace'))
    await join(bus, person('user-b', 'Grace Hopper'))

    render(<PresenceBar awareness={me.awareness} selfId="user-a" connected />)

    expect(screen.queryByTitle('Ada Lovelace')).not.toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  // One person with the note open twice is one person.
  it('shows a collaborator once even with two tabs open', async () => {
    const bus = new MemoryBus()
    const me = await join(bus, person('user-a', 'Ada Lovelace'))
    await join(bus, person('user-b', 'Grace Hopper'))
    await join(bus, person('user-b', 'Grace Hopper'))

    render(<PresenceBar awareness={me.awareness} selfId="user-a" connected />)

    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('renders each person in their own cursor colour', async () => {
    const bus = new MemoryBus()
    const me = await join(bus, person('user-a', 'Ada Lovelace'))
    await join(bus, person('user-b', 'Grace Hopper'))

    render(<PresenceBar awareness={me.awareness} selfId="user-a" connected />)

    expect(screen.getByTitle('Grace Hopper')).toHaveStyle({
      backgroundColor: toRgb(userColor('user-b')),
    })
  })

  /*
   * The reason the colour is hashed rather than picked at random: a
   * collaborator who changes colour on every reload has no identity, and the
   * caret colour's entire job is identity. Asserted across two separate
   * sessions with fresh Yjs client ids, which is what a reload actually is.
   */
  it('gives a person the same colour on every reload', async () => {
    const first = new MemoryBus()
    const before = await join(first, person('user-a', 'Ada'))
    await join(first, person('user-b', 'Grace Hopper'))

    const initial = render(<PresenceBar awareness={before.awareness} selfId="user-a" connected />)
    const firstColor = screen.getByTitle('Grace Hopper').style.backgroundColor
    initial.unmount()

    const second = new MemoryBus()
    const after = await join(second, person('user-a', 'Ada'))
    await join(second, person('user-b', 'Grace Hopper'))

    render(<PresenceBar awareness={after.awareness} selfId="user-a" connected />)

    expect(screen.getByTitle('Grace Hopper').style.backgroundColor).toBe(firstColor)
    // And two different people are told apart, which a single-colour palette
    // would also satisfy the assertion above with.
    expect(userColor('user-b')).not.toBe(userColor('user-a'))
  })

  it('reaches every collaborator from the keyboard', async () => {
    const bus = new MemoryBus()
    const me = await join(bus, person('user-a', 'Ada'))
    await join(bus, person('user-b', 'Grace Hopper'))

    render(<PresenceBar awareness={me.awareness} selfId="user-a" connected />)

    screen.getByTitle('Grace Hopper').focus()
    expect(screen.getByTitle('Grace Hopper')).toHaveFocus()
  })

  /*
   * The half that is not decoration. A dropped Realtime channel is otherwise
   * invisible: the editor keeps accepting keystrokes, they merge locally, and
   * nobody else sees a word of it. Saying so beats letting someone write a page
   * into a document that is not syncing.
   */
  it('says so when the channel has dropped', async () => {
    const bus = new MemoryBus()
    const me = await join(bus, person('user-a', 'Ada'))

    render(<PresenceBar awareness={me.awareness} selfId="user-a" connected={false} />)

    expect(screen.getByRole('status')).toHaveTextContent('Not syncing')
  })

  it('stays out of the way when nobody else is here and everything is fine', async () => {
    const bus = new MemoryBus()
    const me = await join(bus, person('user-a', 'Ada'))

    const { container } = render(
      <PresenceBar awareness={me.awareness} selfId="user-a" connected />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing at all without a session', () => {
    const { container } = render(<PresenceBar awareness={null} selfId="user-a" connected />)
    expect(container).toBeEmptyDOMElement()
  })
})

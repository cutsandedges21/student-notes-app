import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { cn } from '../lib/cn'

/**
 * Who else is in this note, and whether their edits are actually reaching you.
 *
 * Both halves matter. Faces alone are a decoration; the connection state is the
 * part that stops someone typing confidently into a document that has quietly
 * stopped syncing. A dropped Realtime channel is invisible otherwise -- the
 * editor keeps accepting keystrokes, they merge locally, and nobody else sees
 * a word of it until it comes back. Saying so is the honest thing to do.
 *
 * Everything but the component itself is deliberately kept unexported: this
 * file is linted as a component module, and the helpers are small enough to be
 * covered through what the component renders.
 */

interface Peer {
  id: string
  name: string
  color: string
}

interface AwarenessUserState {
  user?: { id?: unknown; name?: unknown; color?: unknown }
}

/**
 * The people in the document other than the reader.
 *
 * Keyed by user id rather than by awareness client id, so one person with the
 * note open in two tabs is one face rather than two strangers. Their own state
 * is dropped: a presence bar that shows you yourself is telling you something
 * you already know, and it reads as a second person in the room.
 */
function peersFromAwareness(awareness: Awareness | null, selfId: string | null): Peer[] {
  if (!awareness) return []

  const byId = new Map<string, Peer>()

  for (const state of awareness.getStates().values()) {
    const user = (state as AwarenessUserState | undefined)?.user
    if (!user) continue

    const id = typeof user.id === 'string' ? user.id : null
    if (!id || id === selfId) continue
    if (byId.has(id)) continue

    byId.set(id, {
      id,
      name: typeof user.name === 'string' && user.name ? user.name : 'Someone',
      color: typeof user.color === 'string' && user.color ? user.color : '#5f6368',
    })
  }

  // Sorted by id, not by arrival: a list that reshuffles as people's updates
  // arrive makes the faces jump about while nothing has actually changed.
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Whether two rosters describe the same room.
 *
 * Awareness fires on every cursor movement, which is most of the traffic in a
 * document two people are actually writing in. Without this the presence bar
 * would re-render on every keystroke anybody makes, to draw the identical two
 * faces.
 */
function samePeers(a: Peer[], b: Peer[]): boolean {
  if (a.length !== b.length) return false
  return a.every((peer, index) => {
    const other = b[index]
    return peer.id === other.id && peer.name === other.name && peer.color === other.color
  })
}

/** Two letters at most, from the first two words. "Ada Lovelace" -> "AL". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

interface PresenceBarProps {
  awareness: Awareness | null
  /** The reader's own user id, so they are not shown to themselves. */
  selfId: string | null
  /** False means the channel has dropped and edits are going nowhere. */
  connected: boolean
  className?: string
}

export function PresenceBar({ awareness, selfId, connected, className }: PresenceBarProps) {
  /*
   * The roster is read during render, not in an effect.
   *
   * People already in the document announced themselves before this component
   * existed, so the first paint has to reflect them -- and doing that from an
   * effect means a first paint that says nobody is here followed immediately by
   * one that says otherwise. The awareness map is kept alongside so a change of
   * session re-reads it: this is React's own "adjust state when a prop changes"
   * pattern, which is a render-phase update rather than a cascading one.
   */
  const [roster, setRoster] = useState(() => ({
    awareness,
    peers: peersFromAwareness(awareness, selfId),
  }))

  if (roster.awareness !== awareness) {
    setRoster({ awareness, peers: peersFromAwareness(awareness, selfId) })
  }

  useEffect(() => {
    if (!awareness) return

    const sync = () =>
      setRoster((current) => {
        const peers = peersFromAwareness(awareness, selfId)
        return samePeers(current.peers, peers) ? current : { awareness, peers }
      })

    awareness.on('change', sync)
    return () => awareness.off('change', sync)
  }, [awareness, selfId])

  const peers = roster.peers

  if (peers.length === 0 && connected) return null

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {peers.length > 0 && (
        <ul aria-label="People editing this note" className="flex items-center">
          {peers.map((peer) => (
            <li key={peer.id} className="-ml-1.5 first:ml-0">
              {/*
                Each face is its own tab stop rather than the list being one.
                A collaborator is a distinct piece of information -- who, and in
                which colour their caret appears -- and a single stop announcing
                a run-together sentence of names loses the mapping between the
                two. The count is small by nature; a note with enough people in
                it for this to be a tabbing burden has other problems.
              */}
              <span
                role="img"
                tabIndex={0}
                aria-label={`${peer.name} is editing this note`}
                title={peer.name}
                data-user-id={peer.id}
                style={{ backgroundColor: peer.color }}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full',
                  'border-2 border-surface font-ui text-[11px] font-medium text-white',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
                  'focus-visible:outline-accent',
                )}
              >
                {initials(peer.name)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!connected && (
        // `role="status"` rather than an alert: it is important and it is not
        // an emergency, so it is announced without interrupting what is being
        // typed.
        <p role="status" className="font-ui text-xs text-ink-muted">
          Not syncing — reconnecting…
        </p>
      )}
    </div>
  )
}

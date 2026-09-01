import { useRef, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * The docked column, shared by the assistant and the comments.
 *
 * Tabs rather than two columns: at the width this panel gets, a second one
 * would leave the page narrower than the text it is simulating. Tabs rather
 * than a dropdown because the count of open comments has to be visible without
 * opening anything -- an unread reply nobody can see is the same as no reply.
 *
 * `role="tablist"` is a promise about keyboard behaviour, so the arrow keys,
 * Home and End are implemented here rather than left to be discovered as
 * missing. Only the selected tab is in the tab order (roving tabindex), which
 * is what the pattern requires: Tab moves past the whole group, arrows move
 * within it.
 */

export interface SidePanelTab {
  id: string
  label: string
  /** Shown beside the label; omitted at zero rather than rendered as "0". */
  count?: number
  content: ReactNode
}

export function SidePanel({
  tabs,
  activeId,
  onSelect,
  className,
}: {
  tabs: SidePanelTab[]
  activeId: string
  onSelect: (id: string) => void
  className?: string
}) {
  const refs = useRef(new Map<string, HTMLButtonElement | null>())

  function focusTab(id: string) {
    onSelect(id)
    refs.current.get(id)?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.id === activeId)
    if (index === -1) return

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        focusTab(tabs[(index + 1) % tabs.length].id)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        focusTab(tabs[(index - 1 + tabs.length) % tabs.length].id)
        break
      case 'Home':
        event.preventDefault()
        focusTab(tabs[0].id)
        break
      case 'End':
        event.preventDefault()
        focusTab(tabs[tabs.length - 1].id)
        break
    }
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div
        role="tablist"
        aria-label="Document panels"
        onKeyDown={onKeyDown}
        className="flex shrink-0 border-b border-line"
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeId
          return (
            <button
              key={tab.id}
              ref={(node) => {
                refs.current.set(tab.id, node)
              }}
              type="button"
              role="tab"
              id={`panel-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-body-${tab.id}`}
              // Roving tabindex: Tab enters the group once, arrows move inside.
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 px-3 py-2 font-ui text-sm transition-colors',
                selected
                  ? 'border-b-2 border-accent font-medium text-ink'
                  : 'border-b-2 border-transparent text-ink-muted hover:bg-surface-hover',
              )}
            >
              {tab.label}
              {tab.count ? (
                <span className="rounded-full bg-accent-subtle px-1.5 py-0.5 text-[11px] font-medium text-accent">
                  {tab.count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-body-${tab.id}`}
          aria-labelledby={`panel-tab-${tab.id}`}
          // Unselected panels are removed rather than hidden with CSS: a
          // `display:none` panel keeps its focusable children in the tab order
          // and its live regions announcing, which is how a hidden assistant
          // ends up reading its answers out over a comment thread.
          hidden={tab.id !== activeId}
          className={cn('min-h-0 flex-1', tab.id === activeId ? 'flex flex-col' : 'hidden')}
        >
          {tab.id === activeId ? tab.content : null}
        </div>
      ))}
    </div>
  )
}

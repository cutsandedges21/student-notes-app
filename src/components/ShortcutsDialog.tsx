import { Dialog } from './ui/Dialog'
import { SHORTCUT_GROUPS } from '../lib/shortcuts'

/**
 * The keyboard shortcut reference, opened from Tools.
 *
 * Rendered from the same table the handlers match against, so a listed key is
 * always a working one.
 */

/** One chord, split so each key gets its own cap. */
function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.split('+').map((key, index) => (
        <span key={key} className="flex items-center gap-1">
          {index > 0 && <span className="text-ink-faint">+</span>}
          <kbd className="rounded border border-line-strong bg-surface-backdrop px-1.5 py-0.5 font-ui text-xs text-ink-muted">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  )
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="mb-5 last:mb-0">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              {group.title}
            </h3>
            <dl className="mt-2">
              {group.items.map((item) => (
                <div
                  key={item.keys}
                  className="flex items-center justify-between gap-4 border-b border-line py-1.5 last:border-b-0"
                >
                  <dt className="text-sm text-ink">{item.description}</dt>
                  <dd>
                    <Keys keys={item.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      {/* The AI actions all run on a selection, which is the one thing about
          them that isn't obvious from the key alone. */}
      <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
        The AI shortcuts work on whatever you have highlighted. With nothing
        selected, the assistant asks which part of your notes you mean.
      </p>
    </Dialog>
  )
}

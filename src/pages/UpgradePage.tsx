import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { AppDocIcon } from '../editor/DocsIcons'
import { cn } from '../lib/cn'

/**
 * Pricing.
 *
 * Everything listed under "Today" is checked against the code. Everything under
 * "Planned" is labelled as planned and claims nothing.
 *
 * This page used to advertise a $6 tier whose five features were, on audit:
 * version history with restore (the snapshots existed, nothing could read
 * them), priority AI with longer context (no tiering of any kind), export to
 * PDF and Word (PDF is the browser's own Save as PDF; Word was never written),
 * offline editing on mobile (no service worker, no manifest, no local
 * persistence beyond guest notes), and unlimited notes as a contrast to a
 * 50-note free cap that `FREE_DOCUMENT_LIMIT` described and nothing enforced.
 *
 * The cap constant is gone rather than made honest. A limit named in the
 * frontend is not a limit -- it would have to be enforced by Postgres to mean
 * anything, and enforcing it would mean building a paywall around a product
 * that takes no payment. Removing the claim is the smaller, truer change.
 *
 * The storage arithmetic that produced 50 is worth keeping, because it is the
 * reason a cap will eventually be needed. A lecture note costs about 6 KB
 * stored: ~3.5 KB of Tiptap JSON, ~1.8 KB of denormalised plain text (both
 * TOAST-compressed), ~0.7 KB of row and index overhead. Across 10,000 users,
 * reserving 30% for indexes and bloat: Supabase's 500 MB free tier allows
 * about 6 notes each, and the 8 GB Pro tier about 98. So a free plan worth
 * offering needs Pro underneath it, and 50 notes each costs 2.9 GB of it.
 */

interface Tier {
  name: string
  price: string
  cadence?: string
  blurb: string
  features: string[]
  cta: string
  ctaTo: string
  featured?: boolean
}

const TIERS: Tier[] = [
  {
    name: 'Today',
    price: '$0',
    blurb: 'Everything Margin does right now, for everyone.',
    features: [
      'Unlimited notes and classes',
      'Full editor: formatting, lists, tables, images, equations, links',
      'Real-time collaboration, with live cursors',
      'Comments and replies, anchored to the passage',
      'Share links, view or edit, revocable',
      'Version history you can browse and restore',
      'Search across every note, by title or by what is in it',
      'Import and export Markdown; import plain text',
      'Paper size, orientation and margins, including A4',
      'AI assistant: improve, check, explain, exam-ready',
      'Print, and save as PDF through your browser',
    ],
    cta: 'Open my notes',
    ctaTo: '/classes',
    featured: true,
  },
  {
    name: 'Planned',
    price: '—',
    blurb: 'Being built. Not available yet, and not charged for.',
    features: [
      'Word files, in and out',
      'Offline editing on mobile',
    ],
    cta: 'Open my notes',
    ctaTo: '/classes',
  },
]

export default function UpgradePage() {
  return (
    <div className="min-h-full bg-surface-backdrop">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-6">
          <Link to="/classes" title="Back to my notes" className="flex items-center gap-2">
            <AppDocIcon className="h-7 w-[22px]" />
            <span className="font-ui text-sm font-medium text-ink">Margin</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-14">
        <div className="text-center">
          <h1 className="text-3xl font-medium text-ink">What Margin does</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
            Margin is free, and everything it can do is on the left. What is still
            being built is on the right, so you can tell the two apart.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {TIERS.map((tier) => (
            <section
              key={tier.name}
              className={cn(
                'flex flex-col rounded-lg border bg-surface p-6',
                tier.featured ? 'border-accent shadow-sheet' : 'border-line',
              )}
            >
              <div className="flex items-baseline justify-between">
                <h2 className="font-ui text-lg font-medium text-ink">{tier.name}</h2>
                {tier.featured && (
                  <span className="rounded-full bg-accent-subtle px-2.5 py-1 text-xs font-medium text-accent">
                    Available now
                  </span>
                )}
              </div>

              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-medium text-ink">{tier.price}</span>
                {tier.cadence && (
                  <span className="text-sm text-ink-muted">{tier.cadence}</span>
                )}
              </p>

              <p className="mt-2 text-sm text-ink-muted">{tier.blurb}</p>

              <ul className="mt-6 flex-1 space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5 text-sm text-ink">
                    <Check size={16} className="mt-0.5 shrink-0 text-accent" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                to={tier.ctaTo}
                className={cn(
                  'mt-8 rounded-full px-4 py-2.5 text-center font-ui text-sm font-medium transition-colors',
                  tier.featured
                    ? 'bg-accent text-accent-on hover:bg-accent-hover'
                    : 'border border-line-strong text-ink hover:bg-surface-hover',
                )}
              >
                {tier.cta}
              </Link>
            </section>
          ))}
        </div>

        {/* Said plainly rather than buried: this is a demo, not a storefront. */}
        <p className="mt-10 text-center text-xs text-ink-faint">
          Margin has no paid plan. No payment is taken and no card is collected.
        </p>
      </main>
    </div>
  )
}

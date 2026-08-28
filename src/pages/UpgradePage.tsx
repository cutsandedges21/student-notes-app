import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { AppDocIcon } from '../editor/DocsIcons'
import { cn } from '../lib/cn'

/**
 * Pricing.
 *
 * The free document cap is not a round number picked for looks -- see
 * FREE_DOCUMENT_LIMIT below for how it falls out of the storage budget.
 */

/**
 * Where 50 comes from.
 *
 * A typical lecture note costs about 6 KB stored: ~3.5 KB of Tiptap JSON and
 * ~1.8 KB of denormalised plain text (both TOAST-compressed by Postgres), plus
 * ~0.7 KB of row and index overhead.
 *
 * Assuming 10,000 users and reserving 30% of the database for indexes, auth
 * tables and bloat:
 *
 *   Supabase Free, 500 MB -> 350 MB usable -> 36 KB/user ->  ~6 notes each
 *   Supabase Pro,    8 GB -> 5.7 GB usable -> 587 KB/user -> ~98 notes each
 *
 * So the 500 MB free tier cannot support a credible free plan at that scale --
 * six notes is less than one course. On Pro, a 50-note cap costs 300 KB/user,
 * or 2.9 GB across 10,000 users, which leaves real headroom.
 */
export const FREE_DOCUMENT_LIMIT = 50

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
    name: 'Free',
    price: '$0',
    blurb: 'Everything you need for a single term.',
    features: [
      `Up to ${FREE_DOCUMENT_LIMIT} notes`,
      'Unlimited classes',
      'Full editor: formatting, lists, images, links',
      'AI assistant: improve, check, explain, exam-ready',
      'Share links, view or edit',
    ],
    cta: 'Your current plan',
    ctaTo: '/classes',
  },
  {
    name: 'Unlimited',
    price: '$6',
    cadence: '/month',
    blurb: 'For students who keep everything, every term.',
    features: [
      'Unlimited notes',
      'Version history with restore',
      'Priority AI, with longer class context',
      'Export to PDF and Word',
      'Offline editing on mobile',
    ],
    cta: 'Upgrade',
    ctaTo: '/classes',
    featured: true,
  },
]

export default function UpgradePage() {
  return (
    <div className="min-h-full bg-surface-backdrop">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-6">
          <Link to="/classes" title="Back to my notes" className="flex items-center gap-2">
            <AppDocIcon className="h-7 w-[22px] text-ink" />
            <span className="font-ui text-sm font-medium text-ink">Margin</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-14">
        <div className="text-center">
          <h1 className="text-3xl font-medium text-ink">Keep every note</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
            Margin is free for a term&rsquo;s worth of notes. Upgrade when you want to
            keep them all, across every course you take.
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
                    Most popular
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
                    ? 'bg-accent text-white hover:bg-accent-hover'
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
          Prices are illustrative. No payment is taken and no card is collected.
        </p>
      </main>
    </div>
  )
}

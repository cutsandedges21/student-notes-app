import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppDocIcon } from '../editor/DocsIcons'

interface AuthLayoutProps {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <main className="grid min-h-full place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/*
          The same lockup as the signed-in header: mark, then wordmark in caps.
          `uppercase` rather than a literal "MARGIN" so the accessible name
          stays a word -- a screen reader is free to spell out all-caps text --
          and `tracking-wide` because the type scale was set for lowercase and
          caps need room between them.

          `inline-flex`, not `flex`: this sits alone in a full-width column, and
          a block link would make every pixel to the right of the wordmark a
          silent way to leave the page you are trying to sign in on.
        */}
        <Link
          to="/"
          aria-label="Margin — go to the home page"
          className="inline-flex items-center gap-2 rounded text-sm font-medium uppercase tracking-wide text-ink"
        >
          <AppDocIcon className="h-7 w-[22px]" />
          Margin
        </Link>
        <h1 className="mt-8 text-2xl font-medium text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-sm text-ink-muted">{footer}</div>}
      </div>
    </main>
  )
}

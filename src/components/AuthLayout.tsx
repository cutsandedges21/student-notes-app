import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

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
        <Link to="/" className="text-sm font-medium tracking-tight text-ink">
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

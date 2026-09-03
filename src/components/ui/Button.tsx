import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  children: ReactNode
  /**
   * React 19 passes `ref` to function components as an ordinary prop, so no
   * forwardRef is needed -- but it is not part of ButtonHTMLAttributes, so it
   * has to be declared to be typed. Dialogs use it to place initial focus.
   */
  ref?: Ref<HTMLButtonElement>
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-on hover:bg-accent-hover disabled:bg-accent/50',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-hover',
  ghost: 'text-ink-muted hover:bg-surface-hover hover:text-ink',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-sm',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

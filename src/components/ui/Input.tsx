import { useId, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Error text rendered below the field and linked via aria-describedby. */
  error?: string
}

export function Input({ label, error, className, ...props }: InputProps) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'h-9 rounded border bg-surface px-3 text-sm text-ink',
          'placeholder:text-ink-faint transition-colors',
          error ? 'border-red-500' : 'border-line-strong hover:border-ink-faint',
          className,
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

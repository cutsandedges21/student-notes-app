/** Relative "last edited" label, e.g. "2 hours ago". */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const seconds = Math.round((Date.now() - then) / 1000)

  if (seconds < 60) return 'just now'

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['month', 2592000],
    ['year', 31536000],
  ]

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0]
  for (const unit of units) {
    if (seconds >= unit[1]) chosen = unit
  }

  return formatter.format(-Math.floor(seconds / chosen[1]), chosen[0])
}

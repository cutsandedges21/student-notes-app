/**
 * Cross-origin policy.
 *
 * This used to answer every request with `Access-Control-Allow-Origin: *`.
 * The endpoint requires a session, so a wildcard did not hand out anyone's
 * notes on its own -- but it did mean any page on the internet could make a
 * browser spend the signed-in visitor's AI quota, using their credentials,
 * from a tab they had open. An allowlist is the difference between "you need a
 * session" and "you need a session AND you have to be on our site".
 *
 * The allowlist is configuration, not code: deployments differ, preview URLs
 * are generated per branch, and a redeploy is a bad way to add a domain.
 *
 *   supabase secrets set ALLOWED_ORIGINS="https://margin.app,https://www.margin.app"
 *
 * Unset falls back to localhost only, which fails closed: a deployment whose
 * origins were never configured stops working in an obvious way rather than
 * quietly accepting everyone.
 */

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

/** Preview deployments, matched by pattern because their host is per-branch. */
const ORIGIN_PATTERNS = [/^https:\/\/[a-z0-9-]+\.vercel\.app$/]

/**
 * Reads configuration without assuming Deno.
 *
 * This module is unit-tested from Vitest, where `Deno` does not exist, and a
 * bare `Deno.env.get` would make the whole file untestable in Node. The rule
 * this file enforces is a security boundary, so it has to be testable; falling
 * back to process.env also makes it configurable in the test itself.
 */
function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno
  if (deno?.env) return deno.env.get(name)
  return (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.[
    name
  ]
}

function allowlist(): string[] {
  const configured = env('ALLOWED_ORIGINS')
  if (!configured) return DEFAULT_ORIGINS
  return configured
    .split(',')
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  const normalised = origin.replace(/\/$/, '')
  if (allowlist().includes(normalised)) return true
  return ORIGIN_PATTERNS.some((pattern) => pattern.test(normalised))
}

/**
 * Headers for a request from `origin`.
 *
 * An origin that is not allowed gets no Allow-Origin header at all, rather
 * than one naming someone else. The browser then blocks the response, which is
 * the intended outcome and is also what a caller reading the headers should
 * see: no permission was granted.
 *
 * `Vary: Origin` because the response differs per origin and a cache that
 * missed that would serve one site's permission to another.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }

  if (origin && isAllowedOrigin(origin)) {
    base['Access-Control-Allow-Origin'] = origin
  }

  return base
}

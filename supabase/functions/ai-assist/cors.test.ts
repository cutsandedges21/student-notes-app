import { describe, it, expect, afterEach } from 'vitest'
import { corsHeaders, isAllowedOrigin } from './cors'

/*
 * The endpoint used to answer every request with
 * `Access-Control-Allow-Origin: *`.
 *
 * It requires a session, so a wildcard did not hand out anyone's notes by
 * itself. What it did allow was any page on the internet making a signed-in
 * visitor's browser spend their AI quota with their credentials, from a tab
 * they had open and were not looking at. These tests are the boundary.
 */

const ORIGINS = 'ALLOWED_ORIGINS'

afterEach(() => {
  delete process.env[ORIGINS]
})

describe('isAllowedOrigin', () => {
  it('falls back to localhost when nothing is configured', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('https://margin.app')).toBe(false)
  })

  it('honours the configured allowlist', () => {
    process.env[ORIGINS] = 'https://margin.app,https://www.margin.app'

    expect(isAllowedOrigin('https://margin.app')).toBe(true)
    expect(isAllowedOrigin('https://www.margin.app')).toBe(true)
  })

  it('tolerates spacing and a trailing slash in configuration', () => {
    process.env[ORIGINS] = ' https://margin.app/ , https://other.app '

    expect(isAllowedOrigin('https://margin.app')).toBe(true)
    expect(isAllowedOrigin('https://margin.app/')).toBe(true)
    expect(isAllowedOrigin('https://other.app')).toBe(true)
  })

  // The attacks the wildcard was open to.
  it('rejects an origin that merely contains an allowed one', () => {
    process.env[ORIGINS] = 'https://margin.app'

    expect(isAllowedOrigin('https://margin.app.evil.com')).toBe(false)
    expect(isAllowedOrigin('https://evil.com/https://margin.app')).toBe(false)
    expect(isAllowedOrigin('https://notmargin.app')).toBe(false)
  })

  it('does not confuse the scheme', () => {
    process.env[ORIGINS] = 'https://margin.app'
    expect(isAllowedOrigin('http://margin.app')).toBe(false)
  })

  it('rejects a missing origin rather than treating it as trusted', () => {
    expect(isAllowedOrigin(null)).toBe(false)
    expect(isAllowedOrigin('')).toBe(false)
  })

  describe('preview deployments', () => {
    it('allows a vercel preview host', () => {
      expect(isAllowedOrigin('https://margin-git-feat-x.vercel.app')).toBe(true)
    })

    it('does not allow a lookalike of one', () => {
      expect(isAllowedOrigin('https://evil.vercel.app.attacker.com')).toBe(false)
      expect(isAllowedOrigin('http://margin.vercel.app')).toBe(false)
      expect(isAllowedOrigin('https://sub.margin.vercel.app')).toBe(false)
    })
  })
})

describe('corsHeaders', () => {
  it('names the caller when it is allowed, never a wildcard', () => {
    process.env[ORIGINS] = 'https://margin.app'
    const headers = corsHeaders('https://margin.app')

    expect(headers['Access-Control-Allow-Origin']).toBe('https://margin.app')
    expect(Object.values(headers)).not.toContain('*')
  })

  /*
   * Grants nothing rather than granting to someone else. The browser then
   * blocks the response, and a non-browser caller reading the headers can see
   * that no permission was given.
   */
  it('grants no origin at all when the caller is not allowed', () => {
    process.env[ORIGINS] = 'https://margin.app'
    const headers = corsHeaders('https://evil.com')

    expect(headers).not.toHaveProperty('Access-Control-Allow-Origin')
  })

  // A shared cache that ignored this would hand one site's grant to another.
  it('varies on Origin, so a cache cannot leak one grant to another site', () => {
    process.env[ORIGINS] = 'https://margin.app'
    expect(corsHeaders('https://margin.app').Vary).toBe('Origin')
    expect(corsHeaders('https://evil.com').Vary).toBe('Origin')
  })

  it('still describes the allowed methods and headers on a refusal', () => {
    const headers = corsHeaders('https://evil.com')
    expect(headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
    expect(headers['Access-Control-Allow-Headers']).toContain('authorization')
  })
})

import { describe, it, expect, vi } from 'vitest'

// documents.ts imports the shared `supabase` client at module scope. That
// client throws synchronously at import time when VITE_SUPABASE_* env vars
// are absent (no Supabase project exists yet in this environment). This
// mock keeps that side effect out of the way so interpretSaveResult — a
// pure function with no Supabase dependency of its own — can be imported
// and tested in isolation. src/lib/supabase.ts itself is untouched.
vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { interpretSaveResult } from './documents'

describe('interpretSaveResult', () => {
  it('reports success when the conditional update matched a row', () => {
    const result = interpretSaveResult({ id: 'doc-1', version: 4 })
    expect(result).toEqual({ status: 'saved', version: 4 })
  })

  it('reports a stale write when no row matched', () => {
    expect(interpretSaveResult(null)).toEqual({ status: 'stale' })
  })
})

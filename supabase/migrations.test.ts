import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Static checks over the SQL, because nothing else here can see it.
 *
 * redeem_share_token was broken from the day it was written and never once
 * succeeded: declared `returns table (document_id uuid, mode text)`, whose
 * output columns are also PL/pgSQL variables, it then wrote
 * `on conflict (document_id, user_id)` -- ambiguous, and 42702 on every call.
 * Nothing recorded a grant, so collaborators were denied the document, the
 * Realtime channel and their own comments.
 *
 * The unit suite could not have caught it: the client was correct, and the
 * failure lived in a function no JavaScript test executes. A local Postgres
 * would catch it, and should -- `supabase db reset` is the real check -- but
 * that needs Docker, which CI does not have here. These are the checks that
 * are worth having without one.
 */

const DIR = join(process.cwd(), 'supabase', 'migrations')

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()

/** Strips comments so they cannot trip the scanners below. */
function code(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

interface PlpgsqlFunction {
  file: string
  name: string
  outputs: string[]
  body: string
}

/** Every plpgsql function that returns a table, with its output column names. */
function tableReturningFunctions(): PlpgsqlFunction[] {
  const found: PlpgsqlFunction[] = []

  for (const file of files) {
    const sql = code(readFileSync(join(DIR, file), 'utf8'))
    const pattern =
      /create or replace function\s+(public\.\w+)[\s\S]*?returns table\s*\(([\s\S]*?)\)\s*language\s+plpgsql([\s\S]*?)\$\$;/gi

    for (const match of sql.matchAll(pattern)) {
      const outputs = match[2]
        .split(',')
        .map((entry) => entry.trim().split(/\s+/)[0])
        .filter(Boolean)
      found.push({ file, name: match[1], outputs, body: match[3] })
    }
  }

  return found
}

describe('migrations', () => {
  it('there are migrations to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('finds the table-returning plpgsql functions', () => {
    // A parser that silently matches nothing would make every check below pass.
    expect(tableReturningFunctions().length).toBeGreaterThan(0)
  })

  /*
   * The exact shape of the bug: an ON CONFLICT naming a column that is also an
   * output variable. Postgres cannot tell them apart and raises 42702 at call
   * time -- not at create time, which is why it shipped.
   */
  it('no ON CONFLICT names a column that is also an output variable', () => {
    const offenders: string[] = []

    for (const fn of tableReturningFunctions()) {
      // A function that opts into column resolution has said which it means.
      if (/#variable_conflict\s+use_column/i.test(fn.body)) continue

      for (const conflict of fn.body.matchAll(/on conflict\s*\(([^)]*)\)/gi)) {
        const columns = conflict[1].split(',').map((entry) => entry.trim())
        const clash = columns.filter((column) => fn.outputs.includes(column))
        if (clash.length > 0) {
          offenders.push(`${fn.name} in ${fn.file}: ${clash.join(', ')}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  /*
   * The same trap one step out: a bare `where <output name> = ...` inside a
   * function whose outputs share that name. Qualifying the table (`d.user_id`)
   * or renaming the output both avoid it.
   */
  it('no unqualified WHERE names an output variable', () => {
    const offenders: string[] = []

    for (const fn of tableReturningFunctions()) {
      if (/#variable_conflict\s+use_column/i.test(fn.body)) continue

      for (const clause of fn.body.matchAll(/where\s+([a-z_][a-z0-9_]*)\s*=/gi)) {
        const column = clause[1]
        if (fn.outputs.includes(column)) {
          offenders.push(`${fn.name} in ${fn.file}: where ${column} = ...`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  // Every migration is applied to a database that already contains it, because
  // the history was written after the schema had been applied by hand.
  it('creates tables and columns idempotently', () => {
    const offenders: string[] = []

    for (const file of files) {
      const sql = code(readFileSync(join(DIR, file), 'utf8')).toLowerCase()

      for (const match of sql.matchAll(/create table\s+(\w+)/g)) {
        if (match[1] !== 'if') offenders.push(`${file}: create table without if not exists`)
      }
      for (const match of sql.matchAll(/add column\s+(\w+)/g)) {
        if (match[1] !== 'if') offenders.push(`${file}: add column without if not exists`)
      }
    }

    expect(offenders).toEqual([])
  })

  // `create policy` has no if-not-exists, so each must be dropped first or a
  // re-run fails on the duplicate name.
  it('drops each policy before creating it', () => {
    const offenders: string[] = []

    for (const file of files) {
      const sql = code(readFileSync(join(DIR, file), 'utf8'))
      const dropped = new Set(
        [...sql.matchAll(/drop policy if exists\s+"([^"]+)"/gi)].map((m) => m[1]),
      )

      for (const created of sql.matchAll(/create policy\s+"([^"]+)"/gi)) {
        if (!dropped.has(created[1])) {
          offenders.push(`${file}: policy "${created[1]}" is created but never dropped first`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('sets an explicit search_path on every security definer function', () => {
    const offenders: string[] = []

    for (const file of files) {
      const sql = code(readFileSync(join(DIR, file), 'utf8'))
      const pattern = /create or replace function[\s\S]*?\$\$/gi

      for (const match of sql.matchAll(pattern)) {
        const header = match[0]
        if (/security definer/i.test(header) && !/set\s+search_path\s*=/i.test(header)) {
          offenders.push(`${file}: a security definer function has no search_path`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})

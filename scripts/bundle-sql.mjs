import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Concatenates the migration history into one file to paste into the Supabase
 * SQL editor.
 *
 * For the case where the CLI cannot reach the project -- no access, no Docker,
 * or simply someone who would rather look at the SQL before running it.
 *
 * The output is generated and gitignored on purpose. A committed copy would be
 * a second description of the schema, and the whole point of deleting
 * schema.sql was that two descriptions drift and the stale one always wins.
 * Regenerate with:
 *
 *   npm run db:bundle
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'supabase', 'migrations')
const outDir = join(here, '..', 'supabase', '.generated')
const outPath = join(outDir, 'apply-all.sql')

// Filename order is apply order -- the timestamps are the version numbers.
const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

if (files.length === 0) throw new Error('No migrations found')

const header = `-- ============================================================================
-- Margin -- full schema, every migration in order.
--
-- GENERATED FILE. Do not edit, and do not commit.
-- Built from supabase/migrations/ by scripts/bundle-sql.mjs.
--
-- Safe to run against a database that already has some or all of this: every
-- statement is idempotent, so anything already present is left alone.
--
-- Run it in the Supabase SQL editor, or:
--   psql "<connection string>" -f supabase/.generated/apply-all.sql
--
-- Migrations included (${files.length}):
${files.map((name) => `--   ${name}`).join('\n')}
-- ============================================================================

`

const body = files
  .map((name) => {
    const sql = readFileSync(join(migrationsDir, name), 'utf8').trim()
    return [
      '-- ' + '='.repeat(74),
      `-- ${name}`,
      '-- ' + '='.repeat(74),
      '',
      sql,
      '',
    ].join('\n')
  })
  .join('\n')

/*
 * Records the history so a later `supabase db push` is a no-op rather than a
 * re-run. Harmless if the CLI has never touched this project -- the table is
 * created if it is missing -- and harmless if it has, because the insert
 * ignores versions already recorded.
 */
const footer = `
-- ${'='.repeat(74)}
-- Migration bookkeeping
--
-- Tells the Supabase CLI that these versions are already applied, so a later
-- \`supabase db push\` does not run them again. Skipping this is not dangerous
-- -- every statement above is idempotent -- it just means the CLI will replay
-- them once.
-- ${'='.repeat(74)}

create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);

insert into supabase_migrations.schema_migrations (version, name)
values
${files
  .map((name) => {
    const version = name.split('_')[0]
    const label = name.replace(/^\d+_/, '').replace(/\.sql$/, '')
    return `  ('${version}', '${label}')`
  })
  .join(',\n')}
on conflict (version) do nothing;
`

mkdirSync(outDir, { recursive: true })
const output = header + body + footer
writeFileSync(outPath, output, 'utf8')

console.log(`Wrote ${outPath}`)
console.log(`${files.length} migrations, ${(output.length / 1024).toFixed(1)} KB`)

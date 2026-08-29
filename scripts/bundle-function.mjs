import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Inlines the ai-assist edge function into one pasteable file.
 *
 * The Supabase dashboard's function editor is awkward with multiple modules,
 * but the split source is what the unit tests import, so it stays the source of
 * truth and this output is generated from it. Regenerate with:
 *
 *   npm run bundle:function
 */

const here = dirname(fileURLToPath(import.meta.url))
const fnDir = join(here, '..', 'supabase', 'functions', 'ai-assist')

const read = (...parts) => readFileSync(join(fnDir, ...parts), 'utf8')

/** Strips local imports and the `export` keyword from a module's body. */
function inline(source) {
  return source
    .replace(/^import .*? from '\.[^']*'\n/gm, '')
    .replace(/^export (const|function|interface|type) /gm, '$1 ')
    .trim()
}

const prompt = inline(read('prompts', 'studentAssistant.ts'))
const context = inline(read('context.ts'))

const index = read('index.ts')
  // Drop the two local imports; their contents are inlined above instead.
  .replace(/^import \{[^}]*\} from '\.\/prompts\/studentAssistant\.ts'\n/m, '')
  .replace(/^import \{[^}]*\} from '\.\/context\.ts'\n/m, '')

const banner = `// GENERATED FILE -- do not edit.
//
// Built from supabase/functions/ai-assist/{prompts/studentAssistant,context,index}.ts
// by scripts/bundle-function.mjs. Edit those, then run:
//
//   npm run bundle:function
//
// This single-file form exists only for pasting into the Supabase dashboard's
// function editor. Deploying with the CLI should use the split source instead.
`

// Remote imports are hoisted to the top. They are legal anywhere at module
// scope, but an import sitting halfway down a file in a dashboard editor
// invites someone to "tidy" it into something that no longer runs.
const remoteImports = []
const body = index.replace(
  /^import .*? from '(?:jsr|npm|https):[^']*'\n/gm,
  (line) => {
    remoteImports.push(line.trim())
    return ''
  },
)

if (remoteImports.length === 0) {
  throw new Error('Expected at least one remote import; the hoist regex has drifted.')
}

const output = [banner, '', ...remoteImports, '', prompt, '', context, '', body.trim()].join(
  '\n',
)

const outPath = join(fnDir, '_bundled.ts')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, output, 'utf8')

console.log(`Wrote ${outPath} (${(output.length / 1024).toFixed(1)} KB)`)

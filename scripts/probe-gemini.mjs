/**
 * Throwaway probe: runs the real system prompt and response schema against the
 * live Gemini API for every mode.
 *
 * The edge function is the only thing that normally makes this call, so a
 * broken prompt or schema shows up as an opaque 502 in the browser. This
 * exercises the same contract directly, where the upstream error is readable.
 *
 *   node scripts/probe-gemini.mjs <api-key> [model]
 */
import { readFileSync } from 'node:fs'

const [, , apiKey, model = 'gemini-3.6-flash'] = process.argv
if (!apiKey) throw new Error('Usage: node scripts/probe-gemini.mjs <api-key> [model]')

const fnDir = 'supabase/functions/ai-assist'

/** Pulls a top-level `const NAME = <literal>` out of a TS source file. */
function extract(file, name) {
  const source = readFileSync(file, 'utf8')
  const start = source.indexOf(`const ${name} = `)
  if (start === -1) throw new Error(`${name} not found in ${file}`)
  const from = start + `const ${name} = `.length
  const open = source[from]
  const close = open === '{' ? '}' : '`'

  if (open === '`') {
    const end = source.indexOf('`', from + 1)
    return source.slice(from + 1, end)
  }

  let depth = 0
  for (let i = from; i < source.length; i++) {
    if (source[i] === open) depth++
    else if (source[i] === close) {
      depth--
      if (depth === 0) return eval(`(${source.slice(from, i + 1)})`)
    }
  }
  throw new Error(`unterminated ${name}`)
}

const SYSTEM_PROMPT = extract(`${fnDir}/prompts/studentAssistant.ts`, 'SYSTEM_PROMPT')
const RESPONSE_SCHEMA = extract(`${fnDir}/index.ts`, 'RESPONSE_SCHEMA')

const NOTES = `Cellular respiration happens in the chloroplast and produces 100 ATP per glucose molecule.
The electron transport chain is in the inner mitochondrial membrane. Oxygen is the final electron acceptor.`

const MODES = ['IMPROVE_NOTES', 'CHECK_NOTES', 'EXPLAIN', 'MAKE_CLEARER', 'EXAM_READY', 'CHAT']

async function run(mode) {
  const prompt = [
    `MODE: ${mode}`,
    `CLASS: Biology 101`,
    `NOTE TITLE: Respiration`,
    mode === 'CHAT' ? `STUDENT QUESTION: Why is oxygen needed at the end?` : '',
    `SELECTED TEXT:\n${NOTES}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    },
  )

  if (!res.ok) return { mode, ok: false, status: res.status, body: (await res.text()).slice(0, 300) }

  const payload = await res.json()
  const parts = payload?.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p) => p?.text).find((v) => typeof v === 'string')
  if (typeof text !== 'string') return { mode, ok: false, reason: 'no text part' }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { mode, ok: false, reason: 'unparseable JSON', text: text.slice(0, 200) }
  }

  return {
    mode,
    ok: true,
    returnedMode: parsed.mode,
    responsePreview: String(parsed.response ?? '').slice(0, 150),
    proposedContent: parsed.proposed_content ? `${String(parsed.proposed_content).slice(0, 90)}…` : null,
    issueCount: Array.isArray(parsed.issues) ? parsed.issues.length : 'MISSING',
    firstIssue: parsed.issues?.[0]
      ? `${parsed.issues[0].original?.slice(0, 45)} → ${parsed.issues[0].correction?.slice(0, 55)} (${parsed.issues[0].confidence})`
      : null,
    addedInfo: Array.isArray(parsed.added_information) ? parsed.added_information.length : 'MISSING',
  }
}

for (const mode of MODES) {
  console.log(JSON.stringify(await run(mode), null, 2))
}

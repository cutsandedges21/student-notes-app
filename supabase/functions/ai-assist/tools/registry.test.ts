import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { TOOLS, functionDeclarations, runTool } from './registry.ts'
import type { ToolContext } from './types.ts'

/**
 * The tool layer.
 *
 * What is being pinned here is not that search works -- it is that nothing the
 * model says can reach the database except through a schema and an ownership
 * check. A tool name it invented, arguments of the wrong shape, a note
 * belonging to somebody else: each has to come back as a result the model can
 * read, and none may throw or run a query.
 */

/** A Supabase client stub whose builder methods chain, like the real one. */
function stubClient(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'or', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  // The query itself is awaited directly in search; make it thenable.
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)

  return {
    from: vi.fn(() => builder),
    __builder: builder,
  }
}

function contextWith(client: unknown): ToolContext {
  return {
    supabase: client as ToolContext['supabase'],
    userId: 'user-1',
    documentId: '11111111-1111-4111-8111-111111111111',
    classId: '22222222-2222-4222-8222-222222222222',
  }
}

describe('the registry', () => {
  it('exposes only tools that cannot write', () => {
    // The first increment is read-only on purpose; writing needs an approval
    // step this layer does not have yet.
    expect(TOOLS.every((tool) => tool.mutates === false)).toBe(true)
  })

  it('declares every tool to the model', () => {
    const declared = functionDeclarations().map((entry) => entry.name).sort()
    expect(declared).toEqual(TOOLS.map((tool) => tool.name).sort())
  })

  /**
   * The Zod schema and the Gemini declaration are written separately, so this
   * is the check that they describe the same tool. A declaration promising an
   * argument the schema rejects would fail every call the model made.
   */
  it('declares exactly the arguments it validates', () => {
    for (const tool of TOOLS) {
      const shape = (tool.input as unknown as z.ZodObject<z.ZodRawShape>).shape
      const validated = Object.keys(shape).sort()
      const declared = Object.keys(tool.parameters.properties).sort()

      expect(declared, `${tool.name} parameters`).toEqual(validated)
    }
  })

  it('requires nothing the schema treats as optional', () => {
    for (const tool of TOOLS) {
      const shape = (tool.input as unknown as z.ZodObject<z.ZodRawShape>).shape
      for (const name of tool.parameters.required ?? []) {
        expect(shape[name]?.isOptional(), `${tool.name}.${name}`).toBe(false)
      }
    }
  })

  it('gives the model a description to choose by', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40)
    }
  })
})

describe('runTool', () => {
  it('refuses a tool that does not exist, rather than throwing', async () => {
    const result = await runTool('drop_all_notes', {}, contextWith(stubClient({ data: [] })))

    expect(result).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      error: 'There is no tool called drop_all_notes.',
    })
  })

  it('refuses arguments that do not match the schema', async () => {
    const client = stubClient({ data: [] })
    const result = await runTool('search_notes', { query: 'x' }, contextWith(client))

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: 'INVALID_ARGUMENTS' })
    // Nothing reached the database.
    expect(client.from).not.toHaveBeenCalled()
  })

  it('refuses a documentId that is not a uuid', async () => {
    const client = stubClient({ data: null })
    const result = await runTool(
      'read_note',
      { documentId: '../../etc/passwd' },
      contextWith(client),
    )

    expect(result).toMatchObject({ code: 'INVALID_ARGUMENTS' })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('turns a thrown error into a result, without leaking the message', async () => {
    const exploding = {
      from: () => {
        throw new Error('relation "documents" does not exist, column user_id')
      },
    }

    const result = await runTool('search_notes', { query: 'osmosis' }, contextWith(exploding))

    expect(result).toEqual({
      ok: false,
      code: 'FAILED',
      error: 'That could not be done just now.',
    })
  })
})

describe('search_notes', () => {
  it('applies its own user filter rather than relying on RLS alone', async () => {
    const client = stubClient({ data: [] })
    await runTool('search_notes', { query: 'osmosis' }, contextWith(client))

    expect(client.__builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('scopes to the open note’s class by default', async () => {
    const client = stubClient({ data: [] })
    await runTool('search_notes', { query: 'osmosis' }, contextWith(client))

    expect(client.__builder.eq).toHaveBeenCalledWith(
      'class_id',
      '22222222-2222-4222-8222-222222222222',
    )
  })

  it('searches everything when asked to', async () => {
    const client = stubClient({ data: [] })
    await runTool(
      'search_notes',
      { query: 'osmosis', scope: 'everywhere' },
      contextWith(client),
    )

    const classFilter = client.__builder.eq.mock.calls.find(
      (call: unknown[]) => call[0] === 'class_id',
    )
    expect(classFilter).toBeUndefined()
  })

  /** `%` is a LIKE wildcard; unescaped it matches every note the student has. */
  it('escapes wildcards in the query', async () => {
    const client = stubClient({ data: [] })
    await runTool('search_notes', { query: '50%' }, contextWith(client))

    const [filter] = client.__builder.or.mock.calls[0]
    expect(filter).toContain('50\\%')
  })

  /**
   * Finding nothing is a true answer. Returning a failure would push the model
   * toward answering from its own memory, which is the fabrication the brief
   * cares most about.
   */
  it('reports an empty result as success', async () => {
    const result = await runTool(
      'search_notes',
      { query: 'osmosis' },
      contextWith(stubClient({ data: [] })),
    )

    expect(result).toMatchObject({ ok: true, data: { found: 0, notes: [] } })
  })

  it('carries where each answer came from', async () => {
    const client = stubClient({
      data: [
        {
          id: 'doc-1',
          title: 'Cells',
          content_text: 'Osmosis is the movement of water.',
          class_id: 'c1',
          classes: { name: 'Biology' },
        },
      ],
    })

    const result = await runTool('search_notes', { query: 'Osmosis' }, contextWith(client))

    expect(result).toMatchObject({
      ok: true,
      data: {
        notes: [
          expect.objectContaining({
            documentId: 'doc-1',
            title: 'Cells',
            className: 'Biology',
          }),
        ],
      },
    })
  })
})

describe('read_note', () => {
  const ID = '33333333-3333-4333-8333-333333333333'

  it('reads a note the student owns', async () => {
    const client = stubClient({
      data: {
        id: ID,
        title: 'Cells',
        content_text: 'Full text.',
        user_id: 'user-1',
        classes: { name: 'Biology' },
      },
    })

    const result = await runTool('read_note', { documentId: ID }, contextWith(client))

    expect(result).toMatchObject({ ok: true, data: { text: 'Full text.', truncated: false } })
  })

  /**
   * Unreachable while RLS holds, which is why it is tested: it is what stops
   * the assistant becoming the way to read somebody else's notes if a later
   * migration ever loosens a policy.
   */
  it('refuses a note belonging to somebody else', async () => {
    const client = stubClient({
      data: {
        id: ID,
        title: 'Someone else’s note',
        content_text: 'Private.',
        user_id: 'user-2',
        classes: { name: 'Biology' },
      },
    })

    const result = await runTool('read_note', { documentId: ID }, contextWith(client))

    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(JSON.stringify(result)).not.toContain('Private.')
  })

  it('says so when a note does not exist', async () => {
    const result = await runTool(
      'read_note',
      { documentId: ID },
      contextWith(stubClient({ data: null })),
    )

    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('reports truncation rather than silently shortening a long note', async () => {
    const client = stubClient({
      data: {
        id: ID,
        title: 'Term notes',
        content_text: 'x'.repeat(20_000),
        user_id: 'user-1',
        classes: { name: 'Biology' },
      },
    })

    const result = await runTool('read_note', { documentId: ID }, contextWith(client))

    expect(result).toMatchObject({ ok: true, data: { truncated: true } })
  })
})

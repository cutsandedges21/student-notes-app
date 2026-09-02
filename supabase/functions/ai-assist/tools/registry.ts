import { searchNotesTool } from './searchNotes.ts'
import { readNoteTool } from './readNote.ts'
import { toolError, type ToolContext, type ToolDefinition, type ToolResult } from './types.ts'

/**
 * Every tool the assistant has, and the one door they are called through.
 *
 * One dispatch point on purpose. Validation, the ownership context and the
 * audit line are things that must happen for every call, and the way they stop
 * happening is a second call site that forgot one -- so there is no way to run
 * a tool except through `runTool`.
 *
 * ## What is deliberately not here yet
 *
 * Nothing that writes. The read tools below cannot destroy anything, which
 * makes them the right thing to prove the layer on: the model can now look
 * things up in the student's own notes, and the worst a malformed call does is
 * return nothing.
 *
 * Writing comes next, and separately, because it needs the half this does not
 * have: a proposal the student approves before it happens. Creating a note
 * also wants the client's `createDocument`, which already handles slugs -- a
 * second slugify in Deno would be two implementations of one rule, which is
 * how this codebase got a link prompt that meant different things in two
 * places.
 */

export const TOOLS: ToolDefinition[] = [
  searchNotesTool as ToolDefinition,
  readNoteTool as ToolDefinition,
]

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

/** The declarations Gemini is given, in the shape its API expects. */
export function functionDeclarations() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

/**
 * How many tool calls one question may make.
 *
 * A model that searches, reads, and answers is using this well. A model
 * looping on a search that returns nothing is not, and without a ceiling that
 * loop is billed per iteration. When it is hit the turn continues without the
 * tool rather than failing: a partial answer beats an error.
 */
export const MAX_TOOL_CALLS = 4

/**
 * Runs a tool the model asked for.
 *
 * Never throws. Every failure comes back as a result the model can read and
 * account for, because the alternative -- an exception ending the turn -- turns
 * "there is no note called that" into a generic error the student cannot act
 * on.
 */
export async function runTool(
  name: string,
  rawArguments: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = BY_NAME.get(name)

  /*
   * A name that is not in the registry is not an error to recover from -- it
   * is the model having invented a capability. Saying so plainly is what stops
   * it trying the same thing again on the next turn.
   */
  if (!tool) {
    return toolError('NOT_FOUND', `There is no tool called ${name}.`)
  }

  const parsed = tool.input.safeParse(rawArguments ?? {})
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'argument'}: ${issue.message}`)
      .join('; ')
    return toolError('INVALID_ARGUMENTS', detail)
  }

  try {
    return await tool.run(parsed.data, context)
  } catch (caught) {
    // The message is not passed on: it can carry column names and constraint
    // text, and the model repeats what it is told.
    console.error(`[tools] ${name} threw`, caught)
    return toolError('FAILED', 'That could not be done just now.')
  }
}

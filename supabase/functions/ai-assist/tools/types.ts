import { z } from 'zod'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * The tool layer: what the assistant is allowed to do, and how.
 *
 * ## The rule this whole layer exists to enforce
 *
 * The model never touches the database. It names a tool and supplies
 * arguments; this layer decides whether that is a thing the caller may do, and
 * then does it. There is no path from model output to a query -- no SQL, no
 * table name, no filter comes from the model, ever. What the model can affect
 * is which of a fixed list of functions runs, with arguments that have been
 * through a schema first.
 *
 * ## Server tools and client proposals
 *
 * Tools are split by what they touch, and the split is a safety boundary
 * rather than a convenience:
 *
 * - **Server tools** run here. They read and write rows through the caller's
 *   own RLS-scoped client, and every one of them re-checks ownership anyway.
 *   Searching notes, reading an outline, creating a new note.
 *
 * - **Client proposals** do not run here at all. Anything that edits the note
 *   currently open comes back as a *proposal* the browser applies, because
 *   the browser is where the live editor is -- and, when the note is being
 *   edited collaboratively, where the CRDT is. A server writing to
 *   `documents.content` under a live Yjs session would be writing to a column
 *   that is no longer the document, and the next sync would silently discard
 *   it. `history/restoreContent.ts` records the same hazard from the other
 *   side.
 *
 * That boundary also happens to give the safety the brief asks for: a change
 * to the open note passes through the anchored applier and a human saying yes,
 * rather than arriving as a fait accompli.
 */

/**
 * The subset of Gemini's function-declaration schema these tools need.
 *
 * Typed rather than `unknown` so a malformed declaration is a compile error
 * instead of a tool the model silently never calls correctly.
 */
export interface GeminiSchema {
  type: 'OBJECT'
  properties: Record<
    string,
    {
      type: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN'
      description?: string
      enum?: string[]
    }
  >
  required?: string[]
}

/** Everything a tool is allowed to know about who is calling it. */
export interface ToolContext {
  /**
   * Scoped to the caller: built with their Authorization header, so RLS is
   * evaluated as them. Tools re-check ownership regardless -- RLS is the
   * thing that makes a mistake here safe, not the thing that excuses it.
   */
  supabase: SupabaseClient
  userId: string
  /** The note the student has open. Anchors "this note" for every tool. */
  documentId: string
  classId: string
}

/**
 * What a tool hands back to the model.
 *
 * Always a value, never a throw: a tool that fails is information the model
 * needs in order to say something true about what happened, and an exception
 * would instead abandon the turn and show a generic error for what may be an
 * ordinary "there is no note by that name".
 */
export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code: ToolErrorCode }

export type ToolErrorCode =
  /** Arguments did not match the schema. */
  | 'INVALID_ARGUMENTS'
  /** The target exists but does not belong to the caller. */
  | 'FORBIDDEN'
  /** The target does not exist. */
  | 'NOT_FOUND'
  /** More than one thing matched and guessing would be wrong. */
  | 'AMBIGUOUS'
  /** The database refused or failed. */
  | 'FAILED'

export const toolError = (code: ToolErrorCode, error: string): ToolResult => ({
  ok: false,
  code,
  error,
})

export const toolOk = (data: unknown): ToolResult => ({ ok: true, data })

/**
 * A tool the model may call.
 *
 * `input` is a Zod schema rather than a hand-written check for the reason
 * `validate.ts` gives about the response: the failure mode of hand-written
 * validation is a field quietly not checked, and here that field would be an
 * argument to something that writes to the database.
 */
export interface ToolDefinition<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  /**
   * Written for the model, not for a developer. It is the only thing that
   * decides whether a tool gets used correctly, so it says what the tool is
   * for and when not to reach for it.
   */
  description: string
  input: Schema
  /**
   * The same arguments, declared the way Gemini wants them.
   *
   * Written out rather than generated from the Zod schema. A converter would
   * be a few hundred lines to cover the cases these schemas actually use, and
   * the interesting part -- the wording of each `description`, which is what
   * the model reads -- cannot be generated at all.
   *
   * The risk in keeping two is that they drift, so a test asserts the property
   * that matters: the declared parameters and the validated ones are the same
   * set, and everything Zod requires is required here too. A tool whose
   * declaration promises an argument the schema rejects would fail every call.
   */
  parameters: GeminiSchema
  /**
   * True for anything that changes stored data.
   *
   * Read-only tools may run without asking. A tool that writes is announced
   * to the student in the transcript, so "the assistant made a note" is never
   * something they discover later.
   */
  mutates: boolean
  run: (args: z.infer<Schema>, context: ToolContext) => Promise<ToolResult>
}

/** Helper that keeps `run`'s argument type tied to the schema. */
export function defineTool<Schema extends z.ZodTypeAny>(
  definition: ToolDefinition<Schema>,
): ToolDefinition<Schema> {
  return definition
}

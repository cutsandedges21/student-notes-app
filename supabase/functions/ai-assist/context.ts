/**
 * Context assembly.
 *
 * Pure functions only -- no Deno APIs, no network, no database. That keeps this
 * layer unit-testable from Vitest even though it ships inside an edge function,
 * and it is the piece most worth testing: everything the model sees is decided
 * here.
 */

export interface ContextClass {
  name: string
  course_code: string
  professor: string
  semester: string
  course_level: string
}

export interface ContextDocument {
  title: string
  content_text: string
}

export interface ContextNote {
  id: string
  title: string
  content_text: string
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Character budgets, in one place so they can be tuned together.
 *
 * Sized to stay well inside Gemini's free tier. Selected text is never
 * truncated: it is the highest-priority signal and is short by nature.
 */
export const BUDGETS = {
  document: 8_000,
  notes: 4_000,
  perNote: 1_500,
  conversationTurns: 6,
  perTurn: 1_000,
  surroundingSelection: 500,
} as const

const MAX_RETRIEVED_NOTES = 3
const MAX_CANDIDATE_NOTES = 10

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…(truncated)`
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'as', 'by', 'at', 'from', 'this', 'that',
  'it', 'its', 'do', 'does', 'did', 'how', 'what', 'why', 'when', 'which', 'i',
  'my', 'me', 'you', 'your', 'can', 'could', 'would', 'should', 'about',
])

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  )
}

/**
 * MVP class memory: rank recent sibling notes by keyword overlap.
 *
 * Deliberately simple, and deliberately behind a narrow interface. Swapping in
 * pgvector embedding search later is a change to this function alone -- no
 * caller needs to know retrieval got smarter.
 */
export function retrieveRelevantNotes(
  siblings: ContextNote[],
  query: string,
  excludeId?: string,
): ContextNote[] {
  const candidates = siblings
    .filter((note) => note.id !== excludeId)
    .slice(0, MAX_CANDIDATE_NOTES)

  const queryWords = keywords(query)
  if (queryWords.size === 0) return candidates.slice(0, MAX_RETRIEVED_NOTES)

  const scored = candidates.map((note, index) => {
    const noteWords = keywords(`${note.title} ${note.content_text}`)
    let overlap = 0
    for (const word of queryWords) if (noteWords.has(word)) overlap += 1
    return { note, overlap, index }
  })

  return scored
    // Ties fall back to the caller's ordering, which is newest-edited first.
    .sort((a, b) => b.overlap - a.overlap || a.index - b.index)
    .slice(0, MAX_RETRIEVED_NOTES)
    .map((entry) => entry.note)
}

export interface BuildContextInput {
  mode: string
  klass: ContextClass
  document: ContextDocument
  selectedText?: string
  userRequest?: string
  siblings: ContextNote[]
  conversation: ConversationTurn[]
  currentDocumentId?: string
}

/**
 * Builds the model input.
 *
 * The section order is fixed and identical on every request. Consistency here
 * measurably steadies model behaviour -- a prompt whose shape changes per call
 * gets answers whose shape changes per call.
 *
 * Student-authored text is wrapped in an explicit data fence. Combined with the
 * system prompt's content-vs-instructions rule, that is what stops notes
 * containing "ignore previous instructions" from being obeyed.
 */
export function buildAIContext(input: BuildContextInput): string {
  const {
    mode,
    klass,
    document,
    selectedText,
    userRequest,
    siblings,
    conversation,
    currentDocumentId,
  } = input

  const fence = (text: string) => `<<<STUDENT_NOTES\n${text}\nSTUDENT_NOTES>>>`

  let documentText = document.content_text.trim()
  if (documentText.length > BUDGETS.document) {
    // Prefer the region around the selection over the document's opening: the
    // student is asking about what they highlighted, not about paragraph one.
    const anchor = selectedText ? documentText.indexOf(selectedText) : -1
    if (anchor > -1) {
      const start = Math.max(0, anchor - Math.floor(BUDGETS.document / 2))
      documentText = `…(truncated)\n${documentText.slice(start, start + BUDGETS.document)}\n…(truncated)`
    } else {
      documentText = truncate(documentText, BUDGETS.document)
    }
  }

  const retrievalQuery = [userRequest, selectedText, document.title]
    .filter(Boolean)
    .join(' ')

  const relevant = retrieveRelevantNotes(siblings, retrievalQuery, currentDocumentId)

  let notesBudget = BUDGETS.notes
  const notesBlock = relevant
    .map((note) => {
      if (notesBudget <= 0) return null
      const body = truncate(note.content_text.trim(), Math.min(BUDGETS.perNote, notesBudget))
      notesBudget -= body.length
      return `--- ${note.title} ---\n${body}`
    })
    .filter(Boolean)
    .join('\n\n')

  const recentTurns = conversation
    .slice(-BUDGETS.conversationTurns)
    .map((turn) => `${turn.role === 'user' ? 'Student' : 'Assistant'}: ${truncate(turn.content, BUDGETS.perTurn)}`)
    .join('\n')

  return [
    `AI MODE:\n${mode}`,
    `COURSE:\n${klass.name}${klass.course_code ? ` (${klass.course_code})` : ''}`,
    `COURSE LEVEL:\n${klass.course_level}`,
    `PROFESSOR:\n${klass.professor || '(not provided)'}`,
    `SEMESTER:\n${klass.semester || '(not provided)'}`,
    `DOCUMENT:\n${document.title || 'Untitled note'}`,
    `SELECTED TEXT:\n${selectedText ? fence(selectedText.trim()) : '(none)'}`,
    `CURRENT DOCUMENT:\n${documentText ? fence(documentText) : '(empty)'}`,
    `RELEVANT CLASS NOTES:\n${notesBlock ? fence(notesBlock) : '(none)'}`,
    `CONVERSATION:\n${recentTurns || '(none)'}`,
    `USER REQUEST:\n${userRequest?.trim() || '(none — follow the AI MODE)'}`,
  ].join('\n\n')
}

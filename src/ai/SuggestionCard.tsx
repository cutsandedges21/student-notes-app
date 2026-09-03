import type { ReactNode } from 'react'
import { FilePlus2, FileText } from 'lucide-react'
import { Button } from '../components/ui/Button'
import type { AiIssue, AiProposedAction, AiResponse, AiSource } from '../types/ai'

/**
 * Renders a proposed edit. The student decides; nothing is ever applied on
 * their behalf.
 */

const CONFIDENCE_WORDING: Record<string, string> = {
  high: 'This appears incorrect',
  medium: 'This may be inaccurate',
  low: 'This might be worth checking',
}

function AddedInformation({ items }: { items: string[] }) {
  if (items.length === 0) return null

  return (
    // Visually separated on purpose. Students revise from these notes later and
    // need to see which claims came from the model rather than from the lecture.
    <div className="mt-3 rounded border border-line bg-surface-backdrop p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        Added by AI — not from your notes
      </p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-ink-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The notes an answer came from.
 *
 * The counterpart to AddedInformation above, and the more useful half: that
 * one says "I made this up", this one says "go and check". Only the notes the
 * assistant actually opened appear here -- the prompt forbids citing a note it
 * did not read, and the id is validated as a uuid on the way in, because a
 * citation that looks authoritative and goes nowhere is worse than none.
 *
 * Rendered as a button rather than a link: the panel does not know a note's
 * class slug, and the caller does. It is also the caller that decides whether
 * opening one should leave the note being edited.
 */
function Sources({
  sources,
  onOpen,
}: {
  sources: AiSource[]
  onOpen?: (source: AiSource) => void
}) {
  if (sources.length === 0) return null

  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        From your notes
      </p>
      <ul className="mt-1.5 space-y-1">
        {sources.map((source) => (
          <li key={source.documentId}>
            <button
              type="button"
              onClick={onOpen ? () => onOpen(source) : undefined}
              disabled={!onOpen}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-sm text-ink-muted transition-colors enabled:hover:bg-surface-hover enabled:hover:text-ink disabled:cursor-default"
            >
              <FileText size={13} className="shrink-0 text-ink-faint" />
              <span className="truncate">{source.title}</span>
              {source.className && (
                <span className="shrink-0 text-xs text-ink-faint">{source.className}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Something the assistant offered to make.
 *
 * An offer, not a result: nothing has happened until this button is pressed.
 * The tool layer on the server is read-only precisely so that anything which
 * creates the student's work has to come through a card like this one.
 *
 * The content is shown before it is made rather than after. A note that
 * appears in a class list unannounced is something to discover and delete;
 * one that is read first is one that was chosen.
 */
function ProposedActions({
  actions,
  onRun,
  running,
  historical,
}: {
  actions: AiProposedAction[]
  onRun?: (action: AiProposedAction) => void
  running?: AiProposedAction | null
  historical?: boolean
}) {
  if (actions.length === 0) return null

  return (
    <div className="mt-3 space-y-3">
      {actions.map((action) => {
        const busy = running?.title === action.title
        return (
          <div key={action.title} className="rounded border border-accent/40 bg-accent/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
              <FilePlus2 size={13} />
              New note
            </p>
            <p className="mt-1.5 text-sm font-medium text-ink">{action.title}</p>
            {action.reason && (
              <p className="mt-0.5 text-sm text-ink-muted">{action.reason}</p>
            )}

            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink">
                Read it first
              </summary>
              <p className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap border-l-2 border-line pl-2 text-sm text-ink-muted">
                {action.content}
              </p>
            </details>

            {historical ? (
              <p className="mt-3 text-xs text-ink-faint">
                From an earlier conversation. Ask again to make it.
              </p>
            ) : (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy}
                  onClick={onRun ? () => onRun(action) : undefined}
                  disabled={!onRun || busy}
                >
                  Create this note
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface IssueListProps {
  issues: AiIssue[]
  onFix: (issue: AiIssue) => void
  onDismiss: (issue: AiIssue) => void
  /** Read back from an earlier session: still worth reading, not applicable. */
  historical?: boolean
}

function IssueList({ issues, onFix, onDismiss, historical = false }: IssueListProps) {
  return (
    <div className="mt-3 space-y-3">
      {issues.map((issue) => (
        <div key={issue.original} className="rounded border border-line bg-surface p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            {CONFIDENCE_WORDING[issue.confidence] ?? 'Potential issue'}
          </p>

          <p className="mt-2 text-sm text-ink-muted">You wrote:</p>
          <p className="mt-0.5 border-l-2 border-line-strong pl-2 text-sm text-ink">
            {issue.original}
          </p>

          <p className="mt-2 text-sm text-ink">{issue.problem}</p>

          <p className="mt-2 text-sm text-ink-muted">Suggested:</p>
          <p className="mt-0.5 border-l-2 border-accent pl-2 text-sm text-ink">
            {issue.correction}
          </p>

          {historical ? (
            /* The correction is still worth reading; applying it is not on
               offer, because the passage it was written against may not be
               there any more. Asking again produces a fresh, anchored one. */
            <p className="mt-3 text-xs text-ink-faint">
              From an earlier conversation. Ask again to apply it.
            </p>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => onFix(issue)}>
                Fix this
              </Button>
              <Button size="sm" onClick={() => onDismiss(issue)}>
                Leave unchanged
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

interface SuggestionCardProps {
  result: AiResponse
  /** The student's text the suggestion would replace, when there was a selection. */
  original?: string
  onApply: (content: string) => void
  onReject: () => void
  onFixIssue: (issue: AiIssue) => void
  onDismissIssue: (issue: AiIssue) => void
  /**
   * Opens a cited note. Absent where the panel cannot navigate -- a shared
   * note opened by a visitor -- in which case the citation still names the
   * note but does not pretend to be a link.
   */
  onOpenSource?: (source: AiSource) => void
  /**
   * Read back from an earlier session.
   *
   * The answer, its citations and what it added are all still worth reading.
   * What is gone is the anchor into the document the suggestion was made
   * against, and without that anchor applying it means pasting old text at a
   * guessed location. So a historical card shows and offers nothing to apply.
   */
  historical?: boolean
  /** Carries out an offer. Absent where nothing can be created. */
  onRunAction?: (action: AiProposedAction) => void
  /** The offer currently being carried out, so its button can show progress. */
  runningAction?: AiProposedAction | null
  /**
   * Rating for this answer, rendered under it.
   *
   * Passed in rather than built here so the card stays a view: it knows what
   * an answer looks like, not who is signed in or where a rating is stored.
   */
  feedback?: ReactNode
}

export function SuggestionCard({
  result,
  original,
  onApply,
  onReject,
  onOpenSource,
  historical = false,
  onFixIssue,
  onDismissIssue,
  onRunAction,
  runningAction,
  feedback,
}: SuggestionCardProps) {
  // A historical card has no anchor to apply against, so it has no proposal
  // to offer -- the text is still shown, just not as something to accept.
  const hasProposal = Boolean(result.proposed_content) && !historical

  return (
    <div className="rounded border border-line bg-surface-backdrop p-3">
      <p className="text-sm text-ink">{result.response}</p>

      {result.issues.length > 0 && (
        <IssueList
          issues={result.issues}
          onFix={onFixIssue}
          onDismiss={onDismissIssue}
          historical={historical}
        />
      )}

      {hasProposal && (
        <div className="mt-3">
          {original && (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Your original
              </p>
              <p className="mt-1 whitespace-pre-wrap border-l-2 border-line-strong pl-2 text-sm text-ink-muted">
                {original}
              </p>
            </>
          )}

          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-faint">
            Suggested
          </p>
          <p className="mt-1 whitespace-pre-wrap border-l-2 border-accent pl-2 text-sm text-ink">
            {result.proposed_content}
          </p>

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => onApply(result.proposed_content!)}
            >
              Apply
            </Button>
            <Button size="sm" onClick={onReject}>
              Reject
            </Button>
          </div>
        </div>
      )}

      <AddedInformation items={result.added_information} />
      <ProposedActions
        actions={result.proposed_actions}
        onRun={onRunAction}
        running={runningAction}
        historical={historical}
      />
      <Sources sources={result.sources} onOpen={onOpenSource} />
      {feedback}
    </div>
  )
}

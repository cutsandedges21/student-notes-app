import { Button } from '../components/ui/Button'
import type { AiIssue, AiResponse } from '../types/ai'

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

interface IssueListProps {
  issues: AiIssue[]
  onFix: (issue: AiIssue) => void
  onDismiss: (issue: AiIssue) => void
}

function IssueList({ issues, onFix, onDismiss }: IssueListProps) {
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

          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => onFix(issue)}>
              Fix this
            </Button>
            <Button size="sm" onClick={() => onDismiss(issue)}>
              Leave unchanged
            </Button>
          </div>
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
}

export function SuggestionCard({
  result,
  original,
  onApply,
  onReject,
  onFixIssue,
  onDismissIssue,
}: SuggestionCardProps) {
  const hasProposal = Boolean(result.proposed_content)

  return (
    <div className="rounded border border-line bg-surface-backdrop p-3">
      <p className="text-sm text-ink">{result.response}</p>

      {result.issues.length > 0 && (
        <IssueList issues={result.issues} onFix={onFixIssue} onDismiss={onDismissIssue} />
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
    </div>
  )
}

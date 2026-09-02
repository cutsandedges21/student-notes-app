-- What an assistant turn was, not just what it said.
--
-- `messages` has held `role` and `content` since it was written, which is
-- enough to redraw a transcript as prose and not enough to redraw it as what
-- the student saw: the citations under an answer, and the list of what the
-- model contributed beyond their notes. Both of those are the parts worth
-- keeping -- "which note did this come from" is exactly the question somebody
-- reopens a conversation to answer.
--
-- Stored as jsonb rather than as columns because it is one validated object
-- read and written whole, never queried by part, and its shape is owned by
-- `validate.ts` -- which is where a change to it should be a change.
--
-- Nullable, so every row written before this exists reads back as a turn with
-- no payload, which is exactly what those rows are.
alter table public.messages
  add column if not exists payload jsonb;

comment on column public.messages.payload is
  'The validated AiResponse for an assistant turn: response, issues, added_information, sources. NULL for user turns and for rows written before this column.';

-- Reopening a note asks for its conversation by document, and there is one
-- per document per person. Without this that is a scan of every conversation
-- the account has.
create index if not exists conversations_user_document_idx
  on public.conversations(user_id, document_id, updated_at desc);

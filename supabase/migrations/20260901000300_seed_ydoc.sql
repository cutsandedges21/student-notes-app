-- Moving an existing note into its Yjs document, exactly once.
--
-- Every note that predates collaborative editing holds its text in
-- `documents.content` as Tiptap JSON, and its `documents.ydoc` is null. The
-- first client to open it collaboratively has to convert that content into a
-- Yjs update and store it. After that the CRDT is the source of truth and this
-- never runs again for that note.
--
-- The whole difficulty is "exactly once". Two people can open the same shared
-- note in the same second, and Yjs updates merge rather than overwrite -- which
-- is the point of a CRDT, and is precisely what makes a double seed so bad. Two
-- independently-built seeds of the same paragraph are not recognised as the
-- same paragraph: they are two separate insertions, and merging them leaves the
-- note holding its own content twice. Nothing errors, nothing warns, and the
-- student finds a duplicated essay.
--
-- So the decision is made in one statement, in the database, and the client is
-- told whether it won:
--
--   update ... where id = $1 and ydoc is null
--
-- Under READ COMMITTED, a second transaction reaching this row while the first
-- is in flight blocks on the row lock, and when it is released Postgres
-- re-evaluates the WHERE clause against the *updated* row. `ydoc` is no longer
-- null, so the predicate now fails, zero rows are affected, and `found` is
-- false. First writer wins; every other writer is told to throw its seed away
-- and re-read. That re-check is the entire safety argument, and it is why this
-- cannot be a read-then-write in the client.
--
-- Returning a boolean rather than raising: losing this race is the ordinary
-- outcome for everyone but the first person to open the note, not an error.

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, deliberately.
--
-- `documents_update_own` restricts UPDATE on documents to the owner, and it
-- should stay that way -- but a collaborator holding an edit grant may legally
-- be the first to open the note, and would then be unable to seed it. The
-- authorisation check is delegated to can_edit_document(), which is the single
-- definition of "may this user edit this document" that the update log and the
-- Realtime channel policies also use. Writing a second rule here is exactly the
-- drift that function exists to prevent.
--
-- Nothing else is reachable through this function: it writes one column, on one
-- row, identified by primary key, and only when that column is still null.
-- ---------------------------------------------------------------------------
drop function if exists public.seed_document_ydoc(uuid, text);
create or replace function public.seed_document_ydoc(
  p_document_id uuid,
  p_ydoc text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  applied boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.can_edit_document(p_document_id) then
    raise exception 'document not found or not permitted';
  end if;

  update public.documents
     set ydoc = p_ydoc,
         ydoc_compacted_at = now()
   where id = p_document_id
     and ydoc is null;

  -- `found` reflects the UPDATE immediately above it, so it is read out before
  -- any other statement can clobber it.
  applied := found;
  return applied;
end;
$$;

grant execute on function public.seed_document_ydoc(uuid, text) to authenticated;

-- Collaborative editing: Yjs document storage.
--
-- The editor's source of truth for a collaborative note stops being
-- `documents.content` (a Tiptap JSON snapshot saved by whoever typed last) and
-- becomes a Yjs document -- a CRDT, where concurrent edits merge instead of
-- one overwriting the other. `documents.content` is still written on every
-- save and is still what search, printing, the AI context layer and every
-- non-collaborative reader use; it is now a derived view of the CRDT rather
-- than the thing being edited.
--
-- Storage is split in two on purpose:
--
--   documents.ydoc          a compacted snapshot of the merged state
--   document_yupdates       an append-only log of updates since that snapshot
--
-- The log is what makes this safe under concurrency. If every client wrote the
-- whole merged state instead, a client that had not yet received someone's
-- update would persist a state missing it, and the last writer would silently
-- drop work -- the exact failure mode collaborative editing exists to remove.
-- Appends cannot conflict, so no writer can erase another's.
--
-- Updates are stored base64-encoded in `text` rather than as `bytea`. Yjs
-- updates are binary, but they travel over Realtime broadcast as JSON and
-- PostgREST renders bytea as a hex string on the way out. One encoding
-- end-to-end is easier to reason about than converting at three boundaries,
-- and the 33% size cost is measured in bytes per keystroke.

alter table public.documents
  add column if not exists ydoc text;

-- When the snapshot was last compacted. Used to decide whether a client's
-- baseline is current enough to skip replaying the whole log.
alter table public.documents
  add column if not exists ydoc_compacted_at timestamptz;

create table if not exists public.document_yupdates (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  -- Who produced it. Not used for merging -- Yjs does not care -- but it is
  -- what makes "who changed this" answerable later, and it is required by the
  -- RLS policy below.
  user_id uuid not null references auth.users(id) on delete cascade,
  update_b64 text not null,
  created_at timestamptz not null default now()
);

-- The load query is "everything for this document, in order".
create index if not exists document_yupdates_document_id_idx
  on public.document_yupdates(document_id, id);

alter table public.document_yupdates enable row level security;

-- ---------------------------------------------------------------------------
-- Compaction.
--
-- Replaying thousands of keystroke-sized updates on every open would make a
-- long-lived note slow to load. Periodically the log is merged into the
-- snapshot and the merged rows dropped.
--
-- The merge itself happens on the client -- Postgres cannot merge a CRDT --
-- so this takes an already-merged state and the id up to which it accounts
-- for. Deleting strictly `<= p_through_id` is what makes it safe: an update
-- inserted while the client was merging has a higher id, survives, and is
-- replayed on top of the new snapshot.
-- ---------------------------------------------------------------------------
drop function if exists public.compact_document_ydoc(uuid, text, bigint);
create or replace function public.compact_document_ydoc(
  p_document_id uuid,
  p_ydoc text,
  p_through_id bigint
)
returns void
language plpgsql
security invoker
as $$
begin
  -- security invoker, so the caller's RLS decides whether they may touch this
  -- document at all. A SECURITY DEFINER here would let anyone who can call the
  -- function rewrite any note's state.
  update public.documents
     set ydoc = p_ydoc,
         ydoc_compacted_at = now()
   where id = p_document_id;

  if not found then
    raise exception 'document not found or not permitted';
  end if;

  delete from public.document_yupdates
   where document_id = p_document_id
     and id <= p_through_id;
end;
$$;

grant execute on function public.compact_document_ydoc(uuid, text, bigint) to authenticated;

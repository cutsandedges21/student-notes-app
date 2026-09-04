-- ---------------------------------------------------------------------------
-- Creating a note was refused by the policy that decides who can read one.
--
-- `documents_select_shared` delegated to `can_view_document(id)`, which is
-- STABLE and answers the ownership half by querying `documents`. A STABLE
-- function reads the snapshot taken when the statement began, so during
--
--   insert into documents (...) values (...) returning *
--
-- it looks for the new row, does not find it -- the statement that is creating
-- it has not finished -- and returns false. Postgres then refuses the RETURNING
-- clause with 42501, which surfaces as "new row violates row-level security
-- policy". The insert itself was always allowed: the same statement with
-- `Prefer: return=minimal` succeeded throughout.
--
-- The fix is to stop asking a table about a row it is in the middle of gaining.
-- Ownership is a column on the candidate row, so the policy tests it directly
-- and is true the instant the row exists. Only the shared case, which genuinely
-- lives in another table, still joins out.
--
-- `can_view_document` is left as it is. It is correct everywhere it is used to
-- gate a *different* table -- comments, access rows -- because there the
-- document really does already exist. It was only ever wrong as the policy on
-- `documents` itself.
-- ---------------------------------------------------------------------------

drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_select_shared" on public.documents;

create policy "documents_select_shared"
  on public.documents for select
  using (
    -- Read off the row being considered. No self-reference, so a row is
    -- visible to its owner from the moment it is written.
    user_id = auth.uid()
    or exists (
      select 1
        from public.document_access a
       where a.document_id = documents.id
         and a.user_id = auth.uid()
    )
  );

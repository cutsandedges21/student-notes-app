-- Page headers, footers and numbering.
--
-- Headers and footers are separate Tiptap documents rather than nodes inside
-- `content`: they repeat on every page conceptually, they are edited in their
-- own mode, and keeping them out of the body means nothing in the main
-- editor's history or selection handling has to know they exist.
--
-- Page numbering stores only the position. The numbers themselves are measured
-- by the pagination engine at render time and are never written down -- a
-- stored page number would be wrong the moment the text above it changed.
--
-- Additive and defaulted, so existing rows come out with empty furniture and
-- numbering off. Nothing that predates these columns has to be backfilled.
alter table public.documents
  add column if not exists header jsonb not null
  default '{"type":"doc","content":[]}'::jsonb;

alter table public.documents
  add column if not exists footer jsonb not null
  default '{"type":"doc","content":[]}'::jsonb;

alter table public.documents
  add column if not exists page_numbers text not null default 'off';

-- Dropped first so re-running against a database that already has the
-- constraint does not fail on the duplicate name.
alter table public.documents
  drop constraint if exists documents_page_numbers_check;

alter table public.documents
  add constraint documents_page_numbers_check
  check (page_numbers in ('off', 'left', 'center', 'right'));

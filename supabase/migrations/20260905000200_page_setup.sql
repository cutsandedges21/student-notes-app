-- Page setup: paper size, orientation, and all four margins.
--
-- The geometry engine has understood Letter, Legal and A4 since it was
-- written -- `PAPER_SIZES` names all three -- and only Letter was ever
-- reachable, with top and bottom margins fixed at an inch and the ruler
-- owning the sides. A4 is the paper almost everywhere outside the US, so for
-- most students the app has only ever printed onto the wrong sheet.
--
-- Stored as jsonb rather than as five columns. It is one setting that is
-- always read and written together, it is never queried by part, and adding
-- `page_setup_margin_left` and its four siblings to a table that already has
-- header, footer and page_numbers would be five migrations' worth of width for
-- one dialog.
--
-- Nullable and defaulted to NULL rather than to a JSON literal: a null means
-- "never chosen", which reads back as the application default, and that keeps
-- the default in one place -- `DEFAULT_PAGE_SETUP` in geometry.ts -- rather
-- than duplicated into a column default that would then have to be migrated
-- every time the default changed.
--
-- `parsePageSetup()` validates on the way out and falls back rather than
-- throwing, so a row written by a newer client, or edited by hand, opens with
-- the default instead of failing to open at all.
alter table public.documents
  add column if not exists page_setup jsonb;

comment on column public.documents.page_setup is
  'Paper size, orientation and margins: {paper, landscape, margins:{top,right,bottom,left}}. NULL means never chosen; the client applies its own default.';

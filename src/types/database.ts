export type CourseLevel = 'High School' | 'College' | 'Graduate'

export interface ProfileRow {
  id: string
  display_name: string
  created_at: string
}

export interface ClassRow {
  id: string
  user_id: string
  name: string
  /** URL segment, unique per user. Links only; rows are keyed by id. */
  slug: string
  course_code: string
  professor: string
  semester: string
  course_level: CourseLevel
  created_at: string
  updated_at: string
}

/** A class row plus the derived note count shown on the dashboard. */
export interface ClassWithCount extends ClassRow {
  note_count: number
}

export interface DocumentRow {
  id: string
  class_id: string
  user_id: string
  title: string
  /** URL segment, unique within its class. */
  slug: string
  /** Tiptap JSON. Typed loosely here; the editor owns the shape. */
  content: unknown
  content_text: string
  /** Page header, its own Tiptap document. */
  header: unknown
  /** Page footer, its own Tiptap document. */
  footer: unknown
  /** Where the page number sits in the footer: off | left | center | right. */
  page_numbers: string
  /**
   * Paper size, orientation and margins.
   *
   * `{ paper, landscape, margins: { top, right, bottom, left } }`, validated on
   * the way out by `parsePageSetup`. Null means never chosen, which reads back
   * as the application default -- so the default lives in one place rather
   * than being duplicated into a column default that would need migrating
   * every time it changed.
   */
  page_setup: unknown
  /**
   * Starred by its owner.
   *
   * Previously a browser-local bookmark written straight to
   * `margin:starred:<documentId>` by the title bar, which meant a star set on
   * a laptop was invisible on a phone and was silently discarded when guest
   * work moved into an account. It is a property of the note, so it lives on
   * the row and travels with it.
   */
  starred: boolean
  /*
   * Server-only columns.
   *
   * Optional because a guest row is a real DocumentRow that has never been
   * near Postgres: notes written signed-out live in localStorage, cannot be
   * shared, and have no CRDT behind them. Marking these optional says that
   * plainly, rather than making the guest store mint fake tokens to satisfy a
   * type. Every reader must therefore cope with their absence.
   */
  /** private | view | edit. Absent on guest rows, which cannot be shared. */
  share_mode?: string
  /** The unguessable half of a share link. Rotating it revokes the old one. */
  share_token?: string
  /**
   * Compacted Yjs state for a collaboratively-edited note.
   *
   * Null until the first collaborative open seeds it from `content`. Never the
   * thing the editor reads directly -- see src/collab/persistence.ts, which
   * merges this with the update log.
   */
  ydoc?: string | null
  /** Optimistic-concurrency counter. See saveDocument(). */
  version: number
  created_at: string
  updated_at: string
}

/** Listing shape for the class page — excludes heavy content columns. */
export type DocumentListItem = Pick<
  DocumentRow,
  'id' | 'class_id' | 'title' | 'slug' | 'created_at' | 'updated_at'
>

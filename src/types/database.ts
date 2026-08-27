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
  /** Tiptap JSON. Typed loosely here; the editor owns the shape. */
  content: unknown
  content_text: string
  /** Optimistic-concurrency counter. See saveDocument(). */
  version: number
  created_at: string
  updated_at: string
}

/** Listing shape for the class page — excludes heavy content columns. */
export type DocumentListItem = Pick<
  DocumentRow,
  'id' | 'class_id' | 'title' | 'created_at' | 'updated_at'
>

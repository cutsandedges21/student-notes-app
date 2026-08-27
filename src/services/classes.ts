import { supabase } from '../lib/supabase'
import type { ClassRow, ClassWithCount, CourseLevel } from '../types/database'

export interface ClassInput {
  name: string
  course_code: string
  professor: string
  semester: string
  course_level: CourseLevel
}

/**
 * Classes for the dashboard, newest-edited first, each with its note count.
 *
 * The count comes from a PostgREST embedded aggregate rather than N follow-up
 * queries. `documents(count)` returns `[{ count: n }]` per row.
 */
export async function fetchClasses(userId: string): Promise<ClassWithCount[]> {
  const { data, error } = await supabase
    .from('classes')
    .select('*, documents(count)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => {
    const { documents, ...rest } = row as ClassRow & {
      documents: { count: number }[]
    }
    return { ...rest, note_count: documents?.[0]?.count ?? 0 }
  })
}

export async function fetchClass(classId: string): Promise<ClassRow | null> {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('id', classId)
    .maybeSingle()

  if (error) throw error
  return data as ClassRow | null
}

export async function createClass(
  userId: string,
  input: ClassInput,
): Promise<ClassRow> {
  const { data, error } = await supabase
    .from('classes')
    .insert({ ...input, user_id: userId })
    .select()
    .single()

  if (error) throw error
  return data as ClassRow
}

export async function updateClass(
  classId: string,
  patch: Partial<ClassInput>,
): Promise<ClassRow> {
  const { data, error } = await supabase
    .from('classes')
    .update(patch)
    .eq('id', classId)
    .select()
    .single()

  if (error) throw error
  return data as ClassRow
}

export async function deleteClass(classId: string): Promise<void> {
  const { error } = await supabase.from('classes').delete().eq('id', classId)
  if (error) throw error
}

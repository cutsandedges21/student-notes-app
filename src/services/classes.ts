import { supabase } from '../lib/supabase'
import type { ClassRow, ClassWithCount, CourseLevel } from '../types/database'
import {
  guestCreateClass,
  guestDeleteClass,
  guestFetchClass,
  guestFetchClasses,
  guestUpdateClass,
} from './guestStore'

export interface ClassInput {
  name: string
  course_code: string
  professor: string
  semester: string
  course_level: CourseLevel
}

/**
 * Every function takes `userId` first: a string when signed in, `null` for a
 * guest working in browser storage. Passing it explicitly (rather than reading
 * a module-level "am I signed in" flag) keeps the backend choice visible at the
 * call site and avoids a hidden global that could be stale during startup.
 */

export async function fetchClasses(userId: string | null): Promise<ClassWithCount[]> {
  if (!userId) return guestFetchClasses()

  const { data, error } = await supabase
    .from('classes')
    .select('*, documents(count)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row) => {
    const { documents, ...rest } = row as ClassRow & { documents: { count: number }[] }
    return { ...rest, note_count: documents?.[0]?.count ?? 0 }
  })
}

export async function fetchClass(
  userId: string | null,
  classId: string,
): Promise<ClassRow | null> {
  if (!userId) return guestFetchClass(classId)

  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('id', classId)
    .maybeSingle()

  if (error) throw error
  return data as ClassRow | null
}

export async function createClass(
  userId: string | null,
  input: ClassInput,
): Promise<ClassRow> {
  if (!userId) return guestCreateClass(input)

  const { data, error } = await supabase
    .from('classes')
    .insert({ ...input, user_id: userId })
    .select()
    .single()

  if (error) throw error
  return data as ClassRow
}

export async function updateClass(
  userId: string | null,
  classId: string,
  patch: Partial<ClassInput>,
): Promise<ClassRow | null> {
  if (!userId) return guestUpdateClass(classId, patch)

  const { data, error } = await supabase
    .from('classes')
    .update(patch)
    .eq('id', classId)
    .select()
    .single()

  if (error) throw error
  return data as ClassRow
}

export async function deleteClass(userId: string | null, classId: string): Promise<void> {
  if (!userId) {
    guestDeleteClass(classId)
    return
  }

  const { error } = await supabase.from('classes').delete().eq('id', classId)
  if (error) throw error
}

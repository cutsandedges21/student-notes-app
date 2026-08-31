import type { JSONContent } from '@tiptap/react'
import { supabase } from '../lib/supabase'
import { extractPlainText } from '../lib/tiptap'
import { createClass } from './classes'
import { createDocument, fetchDocument, saveDocument } from './documents'
import type { SaveResult } from './documents'

/**
 * Link sharing.
 *
 * Reads and writes go through SECURITY DEFINER functions keyed on an
 * unguessable token rather than through a permissive RLS policy. A policy like
 * `using (share_mode <> 'private')` would have let anyone list every shared
 * document in the project; requiring the token means access needs the link.
 */

export type ShareMode = 'private' | 'view' | 'edit'

export const SHARE_MODE_LABELS: Record<ShareMode, string> = {
  private: 'Restricted',
  view: 'Anyone with the link can view',
  edit: 'Anyone with the link can edit',
}

export const SHARE_MODE_HINTS: Record<ShareMode, string> = {
  private: 'Only you can open this note.',
  view: 'Anyone with the link can read it. Signing in is not required.',
  edit: 'Anyone with the link can read it. They must sign in to make changes.',
}

export interface ShareState {
  mode: ShareMode
  token: string
}

export interface SharedDocument {
  id: string
  class_id: string
  class_name: string
  /** Slugs of the copy's destination, so the page can link to it. */
  class_slug: string
  slug: string
  title: string
  content: unknown
  version: number
  share_mode: ShareMode
  owner_id: string
}

export async function fetchShareState(documentId: string): Promise<ShareState | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('share_mode, share_token')
    .eq('id', documentId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return { mode: data.share_mode as ShareMode, token: data.share_token as string }
}

export async function setShareMode(
  documentId: string,
  mode: ShareMode,
): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ share_mode: mode })
    .eq('id', documentId)

  if (error) throw error
}

export function shareUrl(token: string): string {
  return `${window.location.origin}/shared/${token}`
}

/** Readable by anyone holding the token, signed in or not. */
export async function fetchSharedDocument(token: string): Promise<SharedDocument | null> {
  const { data, error } = await supabase.rpc('get_shared_document', { p_token: token })

  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return (row as SharedDocument | undefined) ?? null
}

/**
 * Saves through the shared-document function.
 *
 * Returns 'stale' on a version clash exactly like the owner's save path, so
 * the editor's existing concurrency handling applies unchanged.
 */
export async function saveSharedDocument(params: {
  token: string
  title: string
  content: JSONContent
  expectedVersion: number
}): Promise<SaveResult> {
  const { data, error } = await supabase.rpc('update_shared_document', {
    p_token: params.token,
    p_title: params.title,
    p_content: params.content,
    p_content_text: extractPlainText(params.content),
    p_expected_version: params.expectedVersion,
  })

  if (error) throw error
  if (typeof data !== 'number') return { status: 'stale' }
  return { status: 'saved', version: data }
}

/** The fields needed to choose between same-named classes. */
export interface ClassCandidate {
  id: string
  slug: string
  created_at: string
}

/**
 * Picks one class out of several sharing a name.
 *
 * `classes(user_id, name)` is not unique and cannot be made unique -- real
 * accounts hold two terms of the same course -- so a name lookup can legally
 * return more than one row. Oldest first, ties broken by id, which makes the
 * choice stable across calls, devices and result orderings. Any total order
 * would do; what matters is that repeated copies from the same share link
 * land in the same place rather than scattering.
 */
export function pickDestinationClass(candidates: ClassCandidate[]): ClassCandidate | null {
  if (candidates.length === 0) return null

  return [...candidates].sort((a, b) => {
    const byAge = a.created_at.localeCompare(b.created_at)
    return byAge !== 0 ? byAge : a.id.localeCompare(b.id)
  })[0]
}

/**
 * Every class of this user with the given name, oldest first.
 *
 * Returns an array on purpose. The previous `.maybeSingle()` here raised
 * PGRST116 the moment a second same-named class existed, which turned "Make a
 * copy" into a button that simply failed for anyone who had ever taken a
 * course twice.
 */
export async function findClassesByName(
  userId: string,
  name: string,
): Promise<ClassCandidate[]> {
  const { data, error } = await supabase
    .from('classes')
    .select('id, slug, created_at')
    .eq('user_id', userId)
    .eq('name', name)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as ClassCandidate[]
}

/** Resolve a class by its immutable id. Preferred whenever a caller has one. */
export async function fetchClassCandidateById(
  classId: string,
): Promise<ClassCandidate | null> {
  const { data, error } = await supabase
    .from('classes')
    .select('id, slug, created_at')
    .eq('id', classId)
    .maybeSingle()

  if (error) throw error
  return (data as ClassCandidate | null) ?? null
}

/**
 * Copies a shared note into the reader's own account.
 *
 * The copy lands in a class named after the original, created on first use, so
 * copies from one course stay together instead of piling into one bucket.
 *
 * `destinationClassId` short-circuits the name lookup entirely and is the
 * preferred way in: a class id is immutable and unique, whereas a class name
 * is neither. Callers that already know where the copy should go (a picker, a
 * "copy again into the same class" affordance) should pass it.
 */
export async function copySharedDocument(
  userId: string,
  shared: SharedDocument,
  options?: { destinationClassId?: string },
): Promise<{ classSlug: string; noteSlug: string }> {
  const className = shared.class_name || 'Shared with me'

  const existing = options?.destinationClassId
    ? await fetchClassCandidateById(options.destinationClassId)
    : pickDestinationClass(await findClassesByName(userId, className))

  let classId = existing?.id as string | undefined
  let classSlug = existing?.slug as string | undefined

  if (!classId) {
    const created = await createClass(userId, {
      name: className,
      course_code: '',
      professor: '',
      semester: '',
      course_level: 'College',
    })
    classId = created.id
    classSlug = created.slug
  }

  const content = shared.content as JSONContent

  // Goes through the normal create+save path so the copy gets a slug and a
  // content_text derived exactly as every other note's is.
  const title = shared.title ? `Copy of ${shared.title}` : 'Untitled copy'
  const copy = await createDocument(userId, classId!, title)
  await saveDocument(userId, {
    documentId: copy.id,
    title,
    content,
    expectedVersion: copy.version,
    classId: classId!,
  })

  const saved = await fetchDocument(userId, copy.id)
  return { classSlug: classSlug!, noteSlug: saved?.slug ?? copy.slug }
}

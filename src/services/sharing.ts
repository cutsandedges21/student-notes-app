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

/*
 * The edit hint says what the app actually does, and only that.
 *
 * It used to end "Best one person at a time -- if two people edit at once, the
 * second is asked which version to keep", which was an accurate warning when a
 * shared edit was one person saving a whole snapshot over another's. Editing a
 * shared note now goes through a recorded grant rather than a bare token, and
 * the concurrency story is no longer "second writer loses" -- so leaving that
 * sentence up would be telling people not to do something the app supports.
 *
 * What replaces it is deliberately about access, not about merge mechanics.
 * Two facts are enforced in the database and can be stated without hedging:
 * an anonymous visitor on an edit link cannot write (update_shared_document
 * and redeem_share_token both refuse a null auth.uid()), and a visitor who
 * signs in becomes a row in document_access that the owner can see and delete.
 * Anything stronger -- "changes merge live", "you will see their cursor" --
 * depends on the editor wiring rather than on this layer, so it is not
 * promised here. A share menu is the wrong place to find out that a guarantee
 * was aspirational.
 */
export const SHARE_MODE_HINTS: Record<ShareMode, string> = {
  private: 'Only you can open this note.',
  view: 'Anyone with the link can read it. Signing in is not required.',
  edit: 'Anyone with the link can read it. Editing needs an account: a visitor who signs in is added to the list of people with access, and anyone who stays signed out can only read. Reset the link to take that access back.',
}

export interface ShareState {
  mode: ShareMode
  token: string
  /** Whose note it is. Only the owner may see or revoke the access list. */
  ownerId: string
}

/** What redeeming a share token recorded. */
export interface ShareGrant {
  documentId: string
  mode: Exclude<ShareMode, 'private'>
}

/** One person a share link let in. */
export interface DocumentAccessEntry {
  userId: string
  displayName: string
  mode: Exclude<ShareMode, 'private'>
  /** ISO timestamp of when the link was first redeemed. */
  grantedAt: string
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
    .select('share_mode, share_token, user_id')
    .eq('id', documentId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    mode: data.share_mode as ShareMode,
    token: data.share_token as string,
    ownerId: data.user_id as string,
  }
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

/*
 * Collapses concurrent redemptions of the same token into one request.
 *
 * Not the idempotency guarantee -- that lives in the database, where
 * document_access is keyed on (document_id, user_id) and redeem_share_token
 * inserts ON CONFLICT DO UPDATE, so redeeming the same link a hundred times
 * leaves exactly one row. This map exists because React runs effects twice in
 * StrictMode and a page can remount on any navigation, and two RPCs racing to
 * upsert the same row is pointless traffic even when it is harmless.
 *
 * Only in-flight promises are held. A later visit re-asks the server, because
 * the answer can legitimately change: the owner may have downgraded the link
 * from edit to view, and the grant has to follow it down.
 */
const redemptionsInFlight = new Map<string, Promise<ShareGrant | null>>()

/**
 * Turns a share token into a durable grant in `document_access`.
 *
 * Why this exists at all: Realtime authorises a channel subscription with RLS
 * on `realtime.messages`, which sees a user and knows nothing about the link
 * they followed. A token in a URL cannot authorise a websocket, so the token
 * has to become a recorded fact first.
 *
 * Returns null when the token is unknown, revoked, or points at a note that is
 * no longer shared -- all three, identically. The function is SECURITY DEFINER
 * and returns an empty set in every one of those cases, so there is nothing
 * here for a caller to tell them apart by, and nothing should be added: a
 * distinguishable "wrong token" reply is a free oracle for guessing tokens.
 *
 * Throws only on transport or auth failure (the RPC refuses a null auth.uid(),
 * which is how an anonymous visitor stays read-only on an edit link).
 */
export function redeemShareToken(token: string): Promise<ShareGrant | null> {
  const existing = redemptionsInFlight.get(token)
  if (existing) return existing

  const attempt = requestRedemption(token).finally(() => {
    redemptionsInFlight.delete(token)
  })

  redemptionsInFlight.set(token, attempt)
  return attempt
}

async function requestRedemption(token: string): Promise<ShareGrant | null> {
  const { data, error } = await supabase.rpc('redeem_share_token', { p_token: token })

  if (error) throw error

  const row = (Array.isArray(data) ? data[0] : data) as
    | { document_id: string; mode: string }
    | undefined
    | null

  if (!row) return null
  return { documentId: row.document_id, mode: row.mode as ShareGrant['mode'] }
}

/**
 * Issues a fresh share token and destroys the grants the old one handed out.
 *
 * The audit item behind this: the token was generated once at insert and never
 * changed, so turning sharing off and back on restored the identical secret
 * URL and anyone who had ever seen it still had it. Rotation is the only thing
 * that makes "stop sharing" mean stop.
 *
 * Returns the new token so the caller can show it immediately. Showing the old
 * one after this call would be showing a URL that no longer resolves.
 */
export async function rotateShareToken(documentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_share_token', {
    p_document_id: documentId,
  })

  if (error) throw error
  // The RPC raises when it matches no row, so a non-string here means the
  // contract moved rather than that the caller lacked permission.
  if (typeof data !== 'string') {
    throw new Error('rotate_share_token returned no token')
  }
  return data
}

/**
 * Everyone a share link has let into this note, oldest grant first.
 *
 * Goes through an RPC rather than selecting `document_access` directly only
 * because names live in `profiles`, which is readable to its own row and no
 * further. The function returns an empty list to anyone who is not the
 * document's owner.
 */
export async function listDocumentAccess(
  documentId: string,
): Promise<DocumentAccessEntry[]> {
  const { data, error } = await supabase.rpc('list_document_access', {
    p_document_id: documentId,
  })

  if (error) throw error

  const rows = (data ?? []) as Array<{
    user_id: string
    display_name: string
    mode: string
    granted_at: string
  }>

  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    mode: row.mode as DocumentAccessEntry['mode'],
    grantedAt: row.granted_at,
  }))
}

/**
 * Removes one person's access without disturbing anyone else's.
 *
 * A plain delete, permitted by `document_access_delete_by_owner` and by
 * nothing else, so the authorisation is the row-level policy rather than this
 * function. Rotating the link is the blunt instrument; this is the scalpel.
 *
 * Their link still works, and will re-grant on the next visit -- the token is
 * the credential, and this revokes the grant, not the credential. Reset the
 * link when the intent is that they cannot come back.
 */
export async function revokeDocumentAccess(
  documentId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('document_access')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId)

  if (error) throw error
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
): Promise<{ classSlug: string; noteSlug: string; noteId: string }> {
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
    // The copy is brand new and its title was only just decided, so this is
    // exactly the moment a slug should be derived. Autosave never asks.
    reslug: true,
  })

  const saved = await fetchDocument(userId, copy.id)
  // The id is what the caller actually needs to link to; the slug rides along
  // to keep the address readable.
  return { classSlug: classSlug!, noteSlug: saved?.slug ?? copy.slug, noteId: copy.id }
}

/** A note somebody else shared with the signed-in user. */
export interface SharedWithMe {
  id: string
  title: string
  slug: string
  ownerName: string
  mode: 'view' | 'edit'
  updatedAt: string
}

/**
 * Notes shared with the signed-in user.
 *
 * A grant is what a redeemed share link leaves behind, so this is the list of
 * links they have opened. It is the only place those notes appear: they are
 * not filed in any class of the reader's, because the class belongs to whoever
 * shared it.
 */
export async function listSharedDocuments(): Promise<SharedWithMe[]> {
  const { data, error } = await supabase.rpc('list_shared_documents')
  if (error) throw error

  return ((data ?? []) as {
    id: string
    title: string
    slug: string
    owner_name: string
    mode: 'view' | 'edit'
    updated_at: string
  }[]).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    ownerName: row.owner_name,
    mode: row.mode,
    updatedAt: row.updated_at,
  }))
}

/**
 * Whether the signed-in user can already open a document.
 *
 * Asks the same function the RLS policies ask, so the answer is the one that
 * actually governs access rather than a second opinion about it.
 *
 * Used as a fallback when redeeming a share link fails: a grant that already
 * exists is enough, and refusing to open a note somebody demonstrably has
 * access to -- because re-recording that access errored -- would lock them out
 * over bookkeeping.
 */
export async function canViewDocument(documentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_view_document', {
    p_document_id: documentId,
  })
  if (error) throw error
  return data === true
}

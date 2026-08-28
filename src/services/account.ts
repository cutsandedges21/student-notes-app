import { supabase } from '../lib/supabase'

/**
 * Permanently deletes the signed-in user.
 *
 * Runs server-side as SECURITY DEFINER: the browser's anon key cannot delete
 * an auth user, and the function deletes only `auth.uid()`'s own row. Every
 * table referencing that id cascades, so notes, classes and versions go with
 * it. There is no undo.
 */
export async function deleteOwnAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_own_account')
  if (error) throw error
}

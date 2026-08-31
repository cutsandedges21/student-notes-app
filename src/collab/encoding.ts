/**
 * Yjs updates are binary; the wire is JSON.
 *
 * Supabase Realtime can carry binary over the REST send path, but the
 * WebSocket path's binary support depends on client and server versions, and a
 * mismatch drops messages *silently* -- which in a CRDT means two people
 * diverge with nothing reporting an error. One encoding end to end is worth
 * more than the bytes it costs, and the cost is small: updates are tens to
 * hundreds of bytes, base64 adds a third, and the payload ceiling is 256 KB.
 */

/** Binary to base64, without pulling in a dependency for it. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a
  // document-sized update, which is exactly when it would matter.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Base64 back to binary. */
export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

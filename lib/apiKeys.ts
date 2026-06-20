import { randomBytes, createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const KEY_PREFIX = 'nilli_live_'

/**
 * Generates a new external API key.
 * - `plaintext` is shown to the admin exactly once at creation time.
 * - `hash` (sha256 of the plaintext) is what we store in the DB.
 * - `prefix` is a short, non-secret slice shown in the UI afterward so an
 *   admin can identify which key is which without ever seeing the secret again.
 */
export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  const token = randomBytes(24).toString('base64url')
  const plaintext = `${KEY_PREFIX}${token}`
  const prefix = plaintext.slice(0, KEY_PREFIX.length + 6)
  return { plaintext, prefix, hash: hashApiKey(plaintext) }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export interface ApiKeyRecord {
  id: string
  name: string
}

/**
 * Validates the `Authorization: Bearer <key>` header on an incoming request
 * against the api_keys table. Returns the matching (non-revoked) key record,
 * or null if missing/invalid/revoked. Also fires off a best-effort
 * last_used_at update — callers don't need to await anything extra.
 */
export async function validateApiKey(req: Request): Promise<ApiKeyRecord | null> {
  const authHeader = req.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  const key = match?.[1]?.trim()
  if (!key) return null

  const hash = hashApiKey(key)
  const admin = createAdminClient()
  const { data: row } = await admin
    .from('api_keys')
    .select('id, name, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle()

  if (!row || row.revoked_at) return null

  admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(
    () => {},
    () => {}
  )

  return { id: row.id, name: row.name }
}

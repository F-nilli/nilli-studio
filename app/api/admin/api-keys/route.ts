import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateApiKey } from '@/lib/apiKeys'

export const dynamic = 'force-dynamic'

// List existing keys. Never returns the secret itself — only the
// non-secret prefix, which is enough for an admin to tell keys apart.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: keys, error } = await admin
    .from('api_keys')
    .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ keys: keys || [] }, { headers: { 'Cache-Control': 'no-store' } })
}

// Create a new key. The plaintext secret is returned exactly once, in this
// response — it is never stored anywhere and can't be retrieved again.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name } = await request.json()
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const { plaintext, prefix, hash } = generateApiKey()

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('api_keys')
    .insert({ name: name.trim(), key_prefix: prefix, key_hash: hash, created_by: user.id })
    .select('id, name, key_prefix, created_at')
    .single()

  if (error || !row) {
    return NextResponse.json({ error: error?.message || 'Failed to create key' }, { status: 500 })
  }

  return NextResponse.json({ key: { ...row, secret: plaintext } })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// Deactivating a user must actually remove access, not just hide them in the
// UI. Two layers:
//   1. Supabase Auth ban: blocks new sign-ins and refresh-token renewal, so any
//      open session dies when its access token expires (at most ~1 hour).
//   2. users.active = false: middleware signs the user out on their next page
//      load, so in practice access ends immediately.
// Their tasks, comments and history keep pointing at them, so their name stays
// on past work. Reactivating lifts the ban.
const BAN_DURATION = '876000h' // ~100 years

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (typeof body?.active !== 'boolean') {
    return NextResponse.json({ error: 'Body must be { active: boolean }' }, { status: 400 })
  }
  const active: boolean = body.active

  if (!active && id === user.id) {
    return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: target } = await admin.from('users').select('role, active').eq('id', id).single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Never deactivate the workspace's last active admin.
  if (!active && target.role === 'admin' && target.active !== false) {
    const { count } = await admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .neq('active', false)
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Cannot deactivate the last active admin' }, { status: 400 })
    }
  }

  // Auth first: if the ban fails we must not report the user as locked out.
  const { error: authError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: active ? 'none' : BAN_DURATION,
  })
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

  const { error } = await admin.from('users').update({ active }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // An admin must never be able to delete their own account.
  if (id === user.id) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Guard: never delete the workspace's last active admin, or the workspace
  // is left with nobody able to manage users/settings.
  const { data: target } = await admin.from('users').select('role, active').eq('id', id).single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (target.role === 'admin' && target.active !== false) {
    const { count } = await admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .neq('active', false)
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last active admin' }, { status: 400 })
    }
  }

  // Delete the auth user FIRST: public.users cascades from auth.users, and if
  // anything else (tasks, comments…) still references this user the delete
  // fails cleanly here. The old order deleted the profile row first and
  // ignored its error, which could leave an orphaned auth user with no
  // profile.
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Belt-and-braces: if the cascade didn't remove the profile row, delete it
  // explicitly and surface the error instead of ignoring it.
  const { error: profileError } = await admin.from('users').delete().eq('id', id)
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('workspace_settings')
    .select('task_notifications')
    .limit(1)

  const settings = (rows?.[0] as any)?.task_notifications ?? { deadline_reminder: true, overdue: true }
  return NextResponse.json({ settings }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { settings } = await request.json()

  const admin = createAdminClient()

  const { data: existing } = await admin.from('workspace_settings').select('id').limit(1)
  if (!existing || existing.length === 0) {
    await admin.from('workspace_settings').insert({ task_notifications: settings })
  } else {
    await admin.from('workspace_settings').update({ task_notifications: settings }).not('id', 'is', null)
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

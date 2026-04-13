import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { testSlackToken } from '@/lib/slack'

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
    .select('slack_bot_token, workspace_name')
    .order('id', { ascending: false })
    .limit(1)

  const row = rows?.[0] ?? null

  return NextResponse.json({
    connected: !!row?.slack_bot_token,
    workspaceName: row?.workspace_name || null,
    tokenHint: row?.slack_bot_token ? '…' + row.slack_bot_token.slice(-4) : null,
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { token } = await request.json()

  const test = await testSlackToken(token)
  if (!test.ok) return NextResponse.json({ error: test.error || 'Invalid token' }, { status: 400 })

  const admin = createAdminClient()

  // Delete all existing rows then insert fresh — avoids .single() failing on multiple rows
  await admin.from('workspace_settings').delete().gte('id', 0)
  const { error } = await admin.from('workspace_settings')
    .insert({ slack_bot_token: token, workspace_name: test.team })
  if (error) return NextResponse.json({ error: `Failed to save token: ${error.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, workspaceName: test.team })
}

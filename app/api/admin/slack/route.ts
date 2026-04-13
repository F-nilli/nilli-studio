import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { testSlackToken } from '@/lib/slack'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin.from('workspace_settings').select('slack_bot_token, workspace_name').single()

  return NextResponse.json({
    connected: !!data?.slack_bot_token,
    workspaceName: data?.workspace_name || null,
    tokenHint: data?.slack_bot_token ? '…' + data.slack_bot_token.slice(-4) : null,
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
  const { data: row } = await admin.from('workspace_settings').select('id').single()
  if (row) {
    await admin.from('workspace_settings')
      .update({ slack_bot_token: token, workspace_name: test.team, updated_at: new Date().toISOString() })
      .eq('id', row.id)
  } else {
    await admin.from('workspace_settings')
      .insert({ slack_bot_token: token, workspace_name: test.team })
  }

  return NextResponse.json({ ok: true, workspaceName: test.team })
}

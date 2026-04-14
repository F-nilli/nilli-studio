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
  const { data: rows, error: selectError } = await admin
    .from('workspace_settings')
    .select('slack_bot_token, workspace_name, slack_notifications')
    .limit(1)

  if (selectError) {
    console.error('[Slack GET] select error:', JSON.stringify(selectError))
    return NextResponse.json({ error: `DB read error: ${selectError.message}` }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  console.log('[Slack GET] rows:', JSON.stringify(rows))

  const row = rows?.[0] ?? null

  return NextResponse.json({
    connected: !!row?.slack_bot_token,
    workspaceName: row?.workspace_name || null,
    tokenHint: row?.slack_bot_token ? '…' + row.slack_bot_token.slice(-4) : null,
    notifications: (row as any)?.slack_notifications ?? {},
  }, {
    headers: { 'Cache-Control': 'no-store' },
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

  // Delete all existing rows. id is uuid so we use a uuid-safe filter.
  const { error: deleteError } = await admin
    .from('workspace_settings')
    .delete()
    .not('id', 'is', null)

  if (deleteError) console.error('[Slack POST] delete error:', JSON.stringify(deleteError))

  const { error: insertError } = await admin
    .from('workspace_settings')
    .insert({ slack_bot_token: token, workspace_name: test.team })

  if (insertError) {
    console.error('[Slack POST] insert error:', JSON.stringify(insertError))
    return NextResponse.json({ error: `Failed to save token: ${insertError.message}` }, { status: 500 })
  }

  console.log('[Slack POST] saved token for workspace:', test.team)
  return NextResponse.json({ ok: true, workspaceName: test.team })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { notifications } = await request.json()

  const admin = createAdminClient()
  const { error } = await admin
    .from('workspace_settings')
    .update({ slack_notifications: notifications })
    .not('id', 'is', null)

  if (error) {
    console.error('[Slack PATCH] update error:', JSON.stringify(error))
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

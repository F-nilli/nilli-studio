import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { testSlackToken, SLACK_TEMPLATE_DEFAULTS } from '@/lib/slack'

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
    .select('slack_bot_token, workspace_name, slack_notifications, inapp_notifications, slack_templates')
    .limit(1)

  if (selectError) {
    console.error('[Slack GET] select error:', JSON.stringify(selectError))
    return NextResponse.json({
      connected: false,
      workspaceName: null,
      tokenHint: null,
      notifications: {},
      inappNotifications: {},
      slackTemplates: {},
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  console.log('[Slack GET] rows:', JSON.stringify(rows))

  const row = rows?.[0] ?? null

  return NextResponse.json({
    connected: !!row?.slack_bot_token,
    workspaceName: row?.workspace_name || null,
    tokenHint: row?.slack_bot_token ? '…' + row.slack_bot_token.slice(-4) : null,
    notifications: (row as any)?.slack_notifications ?? {},
    inappNotifications: (row as any)?.inapp_notifications ?? {},
    slackTemplates: (row as any)?.slack_templates ?? {},
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

  const { notifications, inappNotifications, slackTemplates } = await request.json()

  const admin = createAdminClient()
  const updates: Record<string, unknown> = {}
  if (notifications !== undefined) updates.slack_notifications = notifications
  if (inappNotifications !== undefined) updates.inapp_notifications = inappNotifications

  if (slackTemplates !== undefined) {
    // Validate: plain object, known event keys only, string values, sane size.
    // Empty values are dropped — clearing a template resets it to the built-in.
    if (typeof slackTemplates !== 'object' || slackTemplates === null || Array.isArray(slackTemplates)) {
      return NextResponse.json({ error: 'slackTemplates must be an object' }, { status: 400 })
    }
    const knownKeys = new Set(Object.keys(SLACK_TEMPLATE_DEFAULTS))
    const clean: Record<string, string> = {}
    for (const [key, value] of Object.entries(slackTemplates)) {
      if (!knownKeys.has(key)) {
        return NextResponse.json({ error: `Unknown template key: ${key}` }, { status: 400 })
      }
      if (typeof value !== 'string') {
        return NextResponse.json({ error: `Template for ${key} must be text` }, { status: 400 })
      }
      if (value.length > 1000) {
        return NextResponse.json({ error: `Template for ${key} is too long (max 1000 characters)` }, { status: 400 })
      }
      const trimmed = value.trim()
      if (trimmed) clean[key] = trimmed
    }
    updates.slack_templates = clean
  }

  const { error } = await admin
    .from('workspace_settings')
    .update(updates)
    .not('id', 'is', null)

  if (error) {
    console.error('[Slack PATCH] update error:', JSON.stringify(error))
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

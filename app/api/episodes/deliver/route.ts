import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postToSlack, buildEpisodeDeliveredBlocks } from '@/lib/slack'
import { headers } from 'next/headers'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { episodeId } = await req.json()
  if (!episodeId) return NextResponse.json({ error: 'Missing episodeId' }, { status: 400 })

  const admin = createAdminClient()

  const { data: deliverer } = await admin.from('users').select('id, name, role').eq('id', user.id).single()
  if (!deliverer || !['admin', 'ops_manager'].includes(deliverer.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: tasks } = await admin.from('tasks').select('id, label, status, assignee_id').eq('episode_id', episodeId)
  if (!tasks) return NextResponse.json({ error: 'Episode not found' }, { status: 404 })

  const snapshot: Record<string, { status: string; label: string; assignee_id: string }> = {}
  for (const t of tasks) {
    snapshot[t.id] = { status: t.status, label: t.label, assignee_id: t.assignee_id }
  }

  const now = new Date().toISOString()

  const { error: updateError } = await admin.from('episodes').update({
    archived: true,
    completed_at: now,
    published_at: now,
    restored_at: null,
    delivered_by: user.id,
    delivered_task_snapshot: snapshot,
  }).eq('id', episodeId)

  if (updateError) {
    console.error('[deliver] update error:', updateError)
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }

  // Activity log
  admin.from('task_history').insert({
    episode_id: episodeId,
    task_id: null,
    from_status: null,
    to_status: 'delivered',
    changed_by: user.id,
    note: `Episode marked as delivered by ${deliverer.name}`,
  }).then(() => {})

  const { data: episode } = await admin.from('episodes').select('guest_name, client_label, client_key').eq('id', episodeId).single()
  const guestName = episode?.guest_name ?? 'Episode'
  const clientLabel = episode?.client_label ?? ''

  // In-app + push notifications for all assignees except the deliverer
  const assigneeIds = [...new Set(tasks.map(t => t.assignee_id).filter((id): id is string => !!id && id !== user.id))]
  if (assigneeIds.length > 0) {
    const notifications = assigneeIds.map(userId => ({
      user_id: userId,
      type: 'episode_delivered',
      title: 'Episode Delivered',
      body: `${guestName} / ${clientLabel} has been marked as delivered`,
      task_id: null,
      episode_id: episodeId,
      read: false,
    }))
    await admin.from('notifications').insert(notifications)

    const hdrs = await headers()
    const origin = `${req.nextUrl.protocol}//${hdrs.get('host')}`
    for (const userId of assigneeIds) {
      fetch(`${origin}/api/push/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          title: 'Episode Delivered',
          body: `${guestName} / ${clientLabel} has been marked as delivered`,
          url: `/episodes/${episodeId}`,
          tag: 'episode_delivered',
        }),
      }).catch(() => {})
    }
  }

  // Slack notification (fire-and-forget)
  if (episode?.client_key) {
    const { data: settingsRows } = await admin.from('workspace_settings').select('slack_bot_token, slack_notifications').limit(1)
    const settings = settingsRows?.[0] ?? null
    if (settings?.slack_bot_token) {
      const notifPrefs = (settings as any).slack_notifications ?? {}
      if (notifPrefs['episode_delivered'] !== false) {
        const { data: client } = await admin.from('clients').select('slack_channel_id').eq('key', episode.client_key).single()
        if (client?.slack_channel_id) {
          const blocks = buildEpisodeDeliveredBlocks({ clientLabel, guestName, deliveredByName: deliverer.name })
          postToSlack(settings.slack_bot_token, client.slack_channel_id, blocks).catch(() => {})
        }
      }
    }
  }

  return NextResponse.json({ ok: true, completedAt: now })
}

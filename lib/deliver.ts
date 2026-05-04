import type { SupabaseClient } from '@supabase/supabase-js'
import { postToSlack, buildEpisodeDeliveredBlocks } from './slack'

export interface DeliverOptions {
  episodeId: string
  // null when the episode is auto-completing (no explicit deliverer)
  deliveredBy: string | null
  // origin (e.g. https://app.example.com) used for push notifications
  origin: string
  // when true, skip in-app notifications, web push, and the slack message.
  // The DB update, snapshot, and activity log still happen.
  silent?: boolean
}

export interface DeliverResult {
  ok: boolean
  alreadyDelivered?: boolean
  completedAt?: string
  autoCompleted?: boolean
  error?: string
}

/**
 * Marks an episode as delivered/completed and triggers downstream notifications.
 *
 * Used both by the manual `/api/episodes/deliver` endpoint (admin action) and
 * by the auto-archive path inside `/api/tasks/unlock-deps` when the last task
 * of an episode reaches done/approved.
 *
 * Idempotent: if the episode is already archived, returns { ok: true, alreadyDelivered: true }
 * and skips the side effects.
 */
export async function deliverEpisode(
  admin: SupabaseClient,
  { episodeId, deliveredBy, origin, silent = false }: DeliverOptions
): Promise<DeliverResult> {
  const autoCompleted = deliveredBy === null

  // Idempotency guard — bail out if this episode is already archived.
  const { data: existing } = await admin
    .from('episodes')
    .select('archived')
    .eq('id', episodeId)
    .single()
  if (existing?.archived) {
    return { ok: true, alreadyDelivered: true }
  }

  const { data: tasks } = await admin
    .from('tasks')
    .select('id, label, status, assignee_id')
    .eq('episode_id', episodeId)
  if (!tasks) return { ok: false, error: 'Episode not found' }

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
    delivered_by: deliveredBy,
    delivered_task_snapshot: snapshot,
    auto_completed: autoCompleted,
  }).eq('id', episodeId)

  if (updateError) {
    console.error('[deliverEpisode] update error:', updateError)
    return { ok: false, error: 'DB update failed' }
  }

  // Resolve names for activity log + slack message
  let delivererName: string | null = null
  if (deliveredBy) {
    const { data } = await admin.from('users').select('name').eq('id', deliveredBy).single()
    delivererName = data?.name ?? null
  }

  // Activity log
  admin.from('task_history').insert({
    episode_id: episodeId,
    task_id: null,
    from_status: null,
    to_status: 'delivered',
    changed_by: deliveredBy,
    note: autoCompleted
      ? 'Episode auto-completed (all tasks reached done/approved)'
      : `Episode marked as delivered by ${delivererName ?? 'unknown'}`,
  }).then(() => {})

  const { data: episode } = await admin
    .from('episodes')
    .select('guest_name, client_label, client_key')
    .eq('id', episodeId)
    .single()
  const guestName = episode?.guest_name ?? 'Episode'
  const clientLabel = episode?.client_label ?? ''

  // In-app + push notifications for all assignees except the deliverer.
  // Skipped entirely when silent.
  const assigneeIds = [
    ...new Set(
      tasks
        .map(t => t.assignee_id)
        .filter((id): id is string => !!id && id !== deliveredBy)
    ),
  ]
  if (!silent && assigneeIds.length > 0) {
    const notifBody = autoCompleted
      ? `${guestName} / ${clientLabel} auto-completed — all tasks done`
      : `${guestName} / ${clientLabel} has been marked as delivered`
    const notifications = assigneeIds.map(userId => ({
      user_id: userId,
      type: 'episode_delivered',
      title: autoCompleted ? 'Episode Auto-Completed' : 'Episode Delivered',
      body: notifBody,
      task_id: null,
      episode_id: episodeId,
      read: false,
    }))
    await admin.from('notifications').insert(notifications)

    if (origin) {
      for (const userId of assigneeIds) {
        fetch(`${origin}/api/push/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            title: autoCompleted ? 'Episode Auto-Completed' : 'Episode Delivered',
            body: notifBody,
            url: `/episodes/${episodeId}`,
            tag: 'episode_delivered',
          }),
        }).catch(() => {})
      }
    }
  }

  // Slack notification (fire-and-forget). Skipped when silent.
  if (!silent && episode?.client_key) {
    const { data: settingsRows } = await admin
      .from('workspace_settings')
      .select('slack_bot_token, slack_notifications')
      .limit(1)
    const settings = settingsRows?.[0] ?? null
    if (settings?.slack_bot_token) {
      const notifPrefs = (settings as { slack_notifications?: Record<string, boolean> })
        .slack_notifications ?? {}
      if (notifPrefs['episode_delivered'] !== false) {
        const { data: client } = await admin
          .from('clients')
          .select('slack_channel_id')
          .eq('key', episode.client_key)
          .single()
        if (client?.slack_channel_id) {
          const blocks = buildEpisodeDeliveredBlocks({
            clientLabel,
            guestName,
            deliveredByName: delivererName,
            autoCompleted,
          })
          postToSlack(settings.slack_bot_token, client.slack_channel_id, blocks).catch(() => {})
        }
      }
    }
  }

  return { ok: true, completedAt: now, autoCompleted }
}

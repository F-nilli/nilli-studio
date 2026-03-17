import { NotificationType } from './types'

interface NotificationPayload {
  userId: string
  type: NotificationType
  title: string
  body: string
  taskId?: string
  episodeId?: string
  slackWebhookUrl?: string | null
}

export async function sendNotification(
  supabase: ReturnType<typeof import('./supabase/client').createClient>,
  payload: NotificationPayload
) {
  // Save in-app notification
  await supabase.from('notifications').insert({
    user_id: payload.userId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    task_id: payload.taskId || null,
    episode_id: payload.episodeId || null,
    read: false,
  })

  // Send Slack notification if webhook URL exists
  if (payload.slackWebhookUrl) {
    try {
      await fetch(payload.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${payload.title}*\n${payload.body}`,
        }),
      })
    } catch (e) {
      console.error('Slack notification failed:', e)
    }
  }
}

export async function sendNotifications(
  supabase: ReturnType<typeof import('./supabase/client').createClient>,
  payloads: NotificationPayload[]
) {
  for (const payload of payloads) {
    await sendNotification(supabase, payload)
  }
}

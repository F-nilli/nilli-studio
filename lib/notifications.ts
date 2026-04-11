import { NotificationType } from './types'

interface NotificationPayload {
  userId: string
  type: NotificationType
  title: string
  body: string
  taskId?: string
  episodeId?: string
}

export async function sendNotification(
  supabase: ReturnType<typeof import('./supabase/client').createClient>,
  payload: NotificationPayload
) {
  await supabase.from('notifications').insert({
    user_id: payload.userId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    task_id: payload.taskId || null,
    episode_id: payload.episodeId || null,
    read: false,
  })

  // Fire push in background — non-blocking
  fetch('/api/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: payload.userId,
      title: payload.title,
      body: payload.body,
      url: payload.episodeId ? `/episodes/${payload.episodeId}` : '/',
      tag: payload.type,
    }),
  }).catch(() => {})
}

export async function sendNotifications(
  supabase: ReturnType<typeof import('./supabase/client').createClient>,
  payloads: NotificationPayload[]
) {
  for (const payload of payloads) {
    await sendNotification(supabase, payload)
  }
}

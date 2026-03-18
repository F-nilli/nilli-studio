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
}

export async function sendNotifications(
  supabase: ReturnType<typeof import('./supabase/client').createClient>,
  payloads: NotificationPayload[]
) {
  for (const payload of payloads) {
    await sendNotification(supabase, payload)
  }
}

import { NotificationType } from './types'

interface NotificationPayload {
  userId: string
  type: NotificationType
  title: string
  body: string
  taskId?: string
  episodeId?: string
}

// Module-level cache: fetched once per session, expires after 60s
let inappPrefsCache: Record<string, boolean> | null = null
let inappPrefsCachedAt = 0
const INAPP_PREFS_TTL_MS = 60_000

async function getInappPrefs(): Promise<Record<string, boolean>> {
  if (inappPrefsCache !== null && Date.now() - inappPrefsCachedAt < INAPP_PREFS_TTL_MS) {
    return inappPrefsCache
  }
  try {
    const res = await fetch('/api/notification-prefs', { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      inappPrefsCache = data.inappNotifications ?? {}
      inappPrefsCachedAt = Date.now()
      return inappPrefsCache!
    }
  } catch {}
  return inappPrefsCache ?? {}
}

export function invalidateInappPrefsCache() {
  inappPrefsCache = null
  inappPrefsCachedAt = 0
}

export async function sendNotification(
  supabase: ReturnType<typeof import('./supabase/client').createClient>,
  payload: NotificationPayload
) {
  const inappPrefs = await getInappPrefs()
  if (inappPrefs[payload.type] === false) return

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

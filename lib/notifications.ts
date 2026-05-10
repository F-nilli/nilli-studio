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

// Notification types that represent an action the user is being asked to take
// on a task. When the user actually takes that action (status change or
// reassign), these become stale and should auto-mark as read.
//
// FYI types (task_approved, task_comment_mention, release_date_changed,
// task_deadline_changed, episode_delivered) are NOT included — those stay
// unread until the user manually clears them.
const ACTION_REQUIRED_NOTIFICATION_TYPES: NotificationType[] = [
  'task_unlocked',
  'task_submitted_review',
  'task_revision',
  'task_overdue',
  'task_deadline_reminder',
]

/**
 * Mark the current user's unread "action-required" notifications for a
 * specific task as read. Called when the user takes a status-changing
 * action on the task (or reassigns it), so they don't have to manually
 * dismiss the notification afterwards.
 *
 * Fire-and-forget — failure here shouldn't block the user's action.
 */
export async function markTaskNotificationsRead(
  supabase: ReturnType<typeof import('./supabase/client').createClient>,
  userId: string,
  taskId: string
) {
  try {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('task_id', taskId)
      .eq('read', false)
      .in('type', ACTION_REQUIRED_NOTIFICATION_TYPES)
  } catch (err) {
    console.error('[markTaskNotificationsRead]', err)
  }
}

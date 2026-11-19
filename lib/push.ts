import webpush from 'web-push'
import { createAdminClient } from './supabase/admin'

interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
  const admin = createAdminClient()

  // Never notify deactivated team members: payloads carry task and client
  // names. Single choke point for every push sender in the app.
  const { data: recipient } = await admin.from('users').select('active').eq('id', userId).maybeSingle()
  if (!recipient || recipient.active === false) return

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      )
    )
  )

  // Remove expired/invalid subscriptions
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      const err = result.reason as { statusCode?: number }
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await admin.from('push_subscriptions').delete().eq('endpoint', subs[i].endpoint)
      }
    }
  }
}

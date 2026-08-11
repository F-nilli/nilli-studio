import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit } from '@/lib/rateLimit'

// Validated inbox-delivery route.
//
// Why this exists: the notifications table used to allow ANY logged-in user
// to INSERT a notification into ANY other user's inbox with arbitrary type,
// title and body — straight from the browser console. Client code now calls
// this route instead, which authenticates the session, validates the payload
// against a strict shape, and delivers via the service role.

const ALLOWED_TYPES = new Set([
  'task_unlocked',
  'task_submitted_review',
  'task_approved',
  'task_revision',
  'task_overdue',
  'task_deadline_reminder',
  'task_comment_mention',
  'release_date_changed',
  'task_deadline_changed',
  'episode_delivered',
  'task_brief_added',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 60 notifications per minute per sender — far above any real UI flow,
  // stops spam bursts.
  const rl = checkRateLimit(`notif:${user.id}`, 60)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    )
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, type, title, body, taskId, episodeId } = payload as {
    userId?: unknown; type?: unknown; title?: unknown; body?: unknown
    taskId?: unknown; episodeId?: unknown
  }

  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
  }
  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 })
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
  }
  if (typeof body !== 'string' || body.length > 500) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (taskId != null && (typeof taskId !== 'string' || !UUID_RE.test(taskId))) {
    return NextResponse.json({ error: 'Invalid taskId' }, { status: 400 })
  }
  if (episodeId != null && (typeof episodeId !== 'string' || !UUID_RE.test(episodeId))) {
    return NextResponse.json({ error: 'Invalid episodeId' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: recipient } = await admin
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  if (!recipient) return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })

  const { error } = await admin.from('notifications').insert({
    user_id: userId,
    type,
    title: title.trim(),
    body,
    task_id: (taskId as string | undefined) ?? null,
    episode_id: (episodeId as string | undefined) ?? null,
    read: false,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

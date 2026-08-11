import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push'

// Sends a web push to a given user.
//
// Hardening (fix: push spoofing): the previous version accepted any title,
// body and URL for any recipient from any logged-in user — including
// external URLs, which the service worker would happily open on click.
// Now:
//   - payload shape is strictly validated (types + length caps)
//   - url must be a local path ("/episodes/...", "/dashboard", ...) — never
//     an external link, so pushes can't be used to phish
//   - best-effort per-sender rate limit
//
// Note: server-side code (deliver, unlock-deps, cron) no longer calls this
// endpoint — it uses sendPushToUser() directly. This route is for
// browser-originated pushes only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Local absolute path: single leading slash, no protocol-relative "//",
// no scheme, no backslashes.
const LOCAL_PATH_RE = /^\/(?!\/)[^\s\\]*$/

// Best-effort rate limit: max pushes per sender per minute. In-memory —
// resets on cold start, which is fine for catching abuse bursts.
const RATE_LIMIT = 30
const hits = new Map<string, { count: number; resetAt: number }>()

function rateLimited(senderId: string): boolean {
  const now = Date.now()
  const entry = hits.get(senderId)
  if (!entry || now > entry.resetAt) {
    hits.set(senderId, { count: 1, resetAt: now + 60_000 })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (rateLimited(user.id)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, title, body, url, tag } = payload

  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
  }
  if (body != null && (typeof body !== 'string' || body.length > 500)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (url != null && (typeof url !== 'string' || !LOCAL_PATH_RE.test(url))) {
    return NextResponse.json({ error: 'Only local app paths are allowed' }, { status: 400 })
  }
  if (tag != null && (typeof tag !== 'string' || tag.length > 50)) {
    return NextResponse.json({ error: 'Invalid tag' }, { status: 400 })
  }

  await sendPushToUser(userId, {
    title: title.trim(),
    body: (body as string | undefined) ?? '',
    url: (url as string | undefined) ?? '/',
    tag: (tag as string | undefined) ?? undefined,
  })
  return NextResponse.json({ ok: true })
}

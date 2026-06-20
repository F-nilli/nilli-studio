import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateApiKey } from '@/lib/apiKeys'

export const dynamic = 'force-dynamic'

// GET /api/v1/episodes
// Auth: Authorization: Bearer <api key>
// Query params (all optional):
//   client_key  — filter to one client (e.g. "brandon_gentile")
//   archived    — "true" | "false"
//   limit       — default 50, max 200
//   offset      — default 0
//
// Read-only. Deliberately excludes internal fields (footage_url, notes,
// template_name, created_by/delivered_by, delivered_task_snapshot) — those
// are for internal team use, not for external consumers of this API.
export async function GET(req: NextRequest) {
  const apiKey = await validateApiKey(req)
  if (!apiKey) return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientKey = searchParams.get('client_key')
  const archivedParam = searchParams.get('archived')
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200)
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

  const admin = createAdminClient()
  let query = admin
    .from('episodes')
    .select('id, client_key, client_label, guest_name, release_date, release_time, published, published_at, archived, completed_at, created_at', { count: 'exact' })
    .order('release_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (clientKey) query = query.eq('client_key', clientKey)
  if (archivedParam === 'true') query = query.eq('archived', true)
  if (archivedParam === 'false') query = query.eq('archived', false)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const episodes = (data || []).map(e => ({
    ...e,
    status: e.archived ? 'delivered' : 'in_production',
  }))

  return NextResponse.json({
    episodes,
    pagination: { limit, offset, total: count ?? episodes.length },
  })
}

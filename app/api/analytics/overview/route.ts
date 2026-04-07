import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const cache = new Map<string, { data: unknown; ts: number }>()
const TTL = 5 * 60 * 1000

function getRangeStart(range: string): string | null {
  const now = new Date()
  switch (range) {
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    case 'quarter':
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString()
    case 'half':
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString()
    case 'year':
      return new Date(now.getFullYear(), 0, 1).toISOString()
    default:
      return null
  }
}

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get('range') ?? 'all'
  const cacheKey = `overview:${range}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json(hit.data)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'ops_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rangeStart = getRangeStart(range)

  // Completed episodes in range
  let episodeQ = supabase
    .from('episodes')
    .select('id, created_at, published_at, release_date')
    .not('published_at', 'is', null)
  if (rangeStart) episodeQ = episodeQ.gte('published_at', rangeStart)
  const { data: episodes } = await episodeQ
  const completed = (episodes ?? []) as { id: string; created_at: string; published_at: string; release_date: string | null }[]

  // This month count (always, independent of range filter)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { count: thisMonthCount } = await supabase
    .from('episodes')
    .select('id', { count: 'exact', head: true })
    .not('published_at', 'is', null)
    .gte('published_at', monthStart)

  // Avg turnaround: days from created_at to published_at
  let avgTurnaround: number | null = null
  if (completed.length > 0) {
    const totalDays = completed.reduce((sum, e) => {
      return sum + (new Date(e.published_at).getTime() - new Date(e.created_at).getTime()) / 86400000
    }, 0)
    avgTurnaround = totalDays / completed.length
  }

  // On-time delivery: published date <= release_date
  let onTimePercent: number | null = null
  const withRelease = completed.filter(e => e.release_date)
  if (withRelease.length > 0) {
    const onTime = withRelease.filter(e =>
      e.published_at.split('T')[0] <= e.release_date!
    ).length
    onTimePercent = Math.round((onTime / withRelease.length) * 100)
  }

  // Avg revision rounds per episode (from task_history if it exists)
  let avgRevisionRounds: number | null = null
  if (completed.length > 0) {
    const episodeIds = completed.map(e => e.id)
    const { data: revisions, error: revErr } = await supabase
      .from('task_history')
      .select('episode_id')
      .eq('to_status', 'revision')
      .in('episode_id', episodeIds)

    if (!revErr && revisions) {
      const countMap: Record<string, number> = {}
      for (const ep of completed) countMap[ep.id] = 0
      for (const r of revisions as { episode_id: string }[]) {
        countMap[r.episode_id] = (countMap[r.episode_id] ?? 0) + 1
      }
      const counts = Object.values(countMap)
      avgRevisionRounds = counts.reduce((a, b) => a + b, 0) / counts.length
    }
  }

  const data = {
    episodesDelivered: completed.length,
    thisMonthCount: thisMonthCount ?? 0,
    avgTurnaround,
    onTimePercent,
    avgRevisionRounds,
  }

  cache.set(cacheKey, { data, ts: Date.now() })
  return NextResponse.json(data)
}

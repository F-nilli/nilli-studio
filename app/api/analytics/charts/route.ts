import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const cache = new Map<string, { data: unknown; ts: number }>()
const TTL = 5 * 60 * 1000

function getRangeStart(range: string): string | null {
  const now = new Date()
  switch (range) {
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    case 'thirty':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    case 'quarter':
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString()
    case 'year':
      return new Date(now.getFullYear(), 0, 1).toISOString()
    default: // 'all'
      return null
  }
}

// Returns true if any day of the given month (1-indexed) falls within the selected range
function isMonthInRange(year: number, month: number, rangeStart: string | null): boolean {
  if (!rangeStart) return true
  // Last millisecond of the month: day 0 of next month = last day of this month
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999)
  return monthEnd.toISOString() >= rangeStart
}

const CLIENT_COLORS: Record<string, string> = {
  youre_the_voice: '#f7931a',
  walker_america: '#60a5fa',
  bitcoin_edge: '#a78bfa',
  peruvian_bull: '#34d399',
  brandon_gentile: '#fb923c',
}

const COLOR_ROTATION = ['#f7931a', '#60a5fa', '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#38bdf8', '#4ade80', '#facc15', '#c084fc']

function clientColor(key: string, index: number): string {
  return CLIENT_COLORS[key] ?? COLOR_ROTATION[index % COLOR_ROTATION.length]
}

function revisionColor(avg: number): string {
  if (avg > 3) return '#ef4444'
  if (avg >= 2) return '#f59e0b'
  return '#34d399'
}

type EpisodeRow = {
  id: string
  client_key: string
  client_label: string
  created_at: string
  completed_at: string
  release_date: string | null
}

type TaskRow = {
  id: string
  assignee_id: string
  due_date: string | null
  updated_at: string
  episode_id: string
  assignee: { id: string; name: string; avatar_color: string; avatar_url: string | null; active: boolean } | null
}

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get('range') ?? 'thirty'
  const cacheKey = `charts:${range}`
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
  const now = new Date()

  // ── 1. Monthly output — always last 12 months ────────────────────
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const { data: recentEps } = await supabase
    .from('episodes')
    .select('completed_at')
    .eq('archived', true)
    .not('completed_at', 'is', null)
    .is('restored_at', null)
    .gte('completed_at', twelveMonthsAgo.toISOString())

  const months: { label: string; year: number; month: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: d.toLocaleString('en-US', { month: 'short' }),
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    })
  }

  const monthlyCountMap: Record<string, number> = {}
  for (const ep of recentEps ?? []) {
    const d = new Date((ep as { completed_at: string }).completed_at)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`
    monthlyCountMap[key] = (monthlyCountMap[key] ?? 0) + 1
  }

  const monthlyOutput = months.map(m => ({
    label: m.label,
    count: monthlyCountMap[`${m.year}-${m.month}`] ?? 0,
    inRange: isMonthInRange(m.year, m.month, rangeStart),
  }))

  // ── 2. Completed episodes in range ───────────────────────────────
  let completedQ = supabase
    .from('episodes')
    .select('id, client_key, client_label, created_at, completed_at, release_date')
    .eq('archived', true)
    .not('completed_at', 'is', null)
    .is('restored_at', null)
  if (rangeStart) completedQ = completedQ.gte('completed_at', rangeStart)
  const { data: completedEps } = await completedQ
  const completed = (completedEps ?? []) as EpisodeRow[]

  // ── 3. Output by client ──────────────────────────────────────────
  const clientCountMap: Record<string, { label: string; count: number }> = {}
  for (const ep of completed) {
    if (!clientCountMap[ep.client_key]) {
      clientCountMap[ep.client_key] = { label: ep.client_label, count: 0 }
    }
    clientCountMap[ep.client_key].count++
  }
  const outputByClient = Object.entries(clientCountMap)
    .map(([key, val], i) => ({
      clientKey: key,
      clientLabel: val.label,
      count: val.count,
      color: clientColor(key, i),
    }))
    .sort((a, b) => b.count - a.count)

  // ── 4. Turnaround by client ──────────────────────────────────────
  const clientDaysMap: Record<string, { label: string; totalDays: number; count: number }> = {}
  for (const ep of completed) {
    const days = (new Date(ep.completed_at).getTime() - new Date(ep.created_at).getTime()) / 86400000
    if (!clientDaysMap[ep.client_key]) {
      clientDaysMap[ep.client_key] = { label: ep.client_label, totalDays: 0, count: 0 }
    }
    clientDaysMap[ep.client_key].totalDays += days
    clientDaysMap[ep.client_key].count++
  }
  let colorIdx = 0
  const turnaroundByClient = Object.entries(clientDaysMap)
    .map(([key, val]) => ({
      clientKey: key,
      clientLabel: val.label,
      avgDays: val.totalDays / val.count,
      color: clientColor(key, colorIdx++),
    }))
    .sort((a, b) => b.avgDays - a.avgDays)

  // ── 5. Revision rounds by client ─────────────────────────────────
  let revisionByClient: { clientKey: string; clientLabel: string; avg: number; color: string }[] = []
  if (completed.length > 0) {
    const episodeIds = completed.map(e => e.id)
    const { data: revRows, error: revErr } = await supabase
      .from('task_history')
      .select('episode_id')
      .eq('to_status', 'revision')
      .in('episode_id', episodeIds)

    if (!revErr && revRows) {
      const revMap: Record<string, number> = {}
      for (const ep of completed) revMap[ep.id] = 0
      for (const r of revRows as { episode_id: string }[]) {
        revMap[r.episode_id] = (revMap[r.episode_id] ?? 0) + 1
      }

      const clientRevMap: Record<string, { label: string; total: number; episodes: number }> = {}
      for (const ep of completed) {
        if (!clientRevMap[ep.client_key]) {
          clientRevMap[ep.client_key] = { label: ep.client_label, total: 0, episodes: 0 }
        }
        clientRevMap[ep.client_key].total += revMap[ep.id] ?? 0
        clientRevMap[ep.client_key].episodes++
      }

      revisionByClient = Object.entries(clientRevMap)
        .map(([key, val]) => {
          const avg = val.total / val.episodes
          return {
            clientKey: key,
            clientLabel: val.label,
            avg,
            color: revisionColor(avg),
          }
        })
        .sort((a, b) => b.avg - a.avg)
    }
  }

  // ── 6. Team task completion ──────────────────────────────────────
  let teamCompletion: {
    userId: string
    name: string
    avatarColor: string
    avatarUrl: string | null
    totalCompleted: number
    onTimePercent: number | null
  }[] = []

  const { data: histRows, error: histErr } = await supabase
    .from('task_history')
    .select('task_id, changed_at, changed_by')
    .eq('to_status', 'approved')
    .gte('changed_at', rangeStart ?? '2000-01-01T00:00:00Z')

  type HistRow = { task_id: string; changed_at: string; changed_by: string }
  type TeamEntry = { completed: number; onTime: number; withDue: number }

  if (!histErr && histRows && histRows.length > 0) {
    const taskIds = [...new Set((histRows as HistRow[]).map(r => r.task_id))]
    const { data: taskData } = await supabase
      .from('tasks')
      .select('id, assignee_id, due_date, assignee:users!assignee_id(id, name, avatar_color, avatar_url, active)')
      .in('id', taskIds)

    const taskMap = new Map<string, TaskRow>()
    for (const t of (taskData ?? []) as unknown as TaskRow[]) taskMap.set(t.id, t)

    const userMap = new Map<string, TaskRow['assignee'] & TeamEntry>()

    for (const row of histRows as HistRow[]) {
      const task = taskMap.get(row.task_id)
      if (!task?.assignee?.active) continue

      const uid = task.assignee_id
      if (!userMap.has(uid)) {
        userMap.set(uid, { ...task.assignee!, completed: 0, onTime: 0, withDue: 0 })
      }
      const entry = userMap.get(uid)!
      entry.completed++
      if (task.due_date) {
        entry.withDue++
        if (row.changed_at <= task.due_date) entry.onTime++
      }
    }

    teamCompletion = Array.from(userMap.entries()).map(([, e]) => ({
      userId: e.id,
      name: e.name,
      avatarColor: e.avatar_color,
      avatarUrl: e.avatar_url,
      totalCompleted: e.completed,
      onTimePercent: e.withDue > 0 ? Math.round((e.onTime / e.withDue) * 100) : null,
    })).sort((a, b) => b.totalCompleted - a.totalCompleted)
  } else {
    // Fallback: use tasks.updated_at
    let taskQ = supabase
      .from('tasks')
      .select('id, assignee_id, due_date, updated_at, assignee:users!assignee_id(id, name, avatar_color, avatar_url, active)')
      .in('status', ['approved', 'done'])
    if (rangeStart) taskQ = taskQ.gte('updated_at', rangeStart)
    const { data: taskData } = await taskQ

    const userMap = new Map<string, TaskRow['assignee'] & TeamEntry>()
    for (const t of (taskData ?? []) as unknown as TaskRow[]) {
      if (!t.assignee?.active) continue
      const uid = t.assignee_id
      if (!userMap.has(uid)) {
        userMap.set(uid, { ...t.assignee!, completed: 0, onTime: 0, withDue: 0 })
      }
      const entry = userMap.get(uid)!
      entry.completed++
      if (t.due_date) {
        entry.withDue++
        if (t.updated_at <= t.due_date) entry.onTime++
      }
    }

    teamCompletion = Array.from(userMap.entries()).map(([, e]) => ({
      userId: e.id,
      name: e.name,
      avatarColor: e.avatar_color,
      avatarUrl: e.avatar_url,
      totalCompleted: e.completed,
      onTimePercent: e.withDue > 0 ? Math.round((e.onTime / e.withDue) * 100) : null,
    })).sort((a, b) => b.totalCompleted - a.totalCompleted)
  }

  // ── 7. Overdue active episodes (for insights) ────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const { count: overdueCount } = await supabase
    .from('episodes')
    .select('id', { count: 'exact', head: true })
    .eq('archived', false)
    .lt('release_date', sevenDaysAgo)

  // ── 8. Studio insights ───────────────────────────────────────────
  const insights: { color: 'red' | 'green' | 'amber'; text: string }[] = []

  if (revisionByClient.length >= 2) {
    const studioAvg = revisionByClient.reduce((s, c) => s + c.avg, 0) / revisionByClient.length
    const worst = revisionByClient[0]
    if (worst.avg > studioAvg * 1.2 && worst.avg > 0.5) {
      insights.push({
        color: 'amber',
        text: `${worst.clientLabel} has the highest revision rate (${worst.avg.toFixed(1)} avg vs ${studioAvg.toFixed(1)} studio avg)`,
      })
    }
  }

  const teamWithOnTime = teamCompletion.filter(m => m.onTimePercent !== null && m.totalCompleted >= 3)
  if (teamWithOnTime.length > 0) {
    const best = [...teamWithOnTime].sort((a, b) => (b.onTimePercent ?? 0) - (a.onTimePercent ?? 0))[0]
    if ((best.onTimePercent ?? 0) >= 90) {
      insights.push({
        color: 'green',
        text: `${best.name} is the most reliable team member — ${best.onTimePercent}% on-time across ${best.totalCompleted} tasks`,
      })
    }

    const worst = [...teamWithOnTime].sort((a, b) => (a.onTimePercent ?? 100) - (b.onTimePercent ?? 100))[0]
    if ((worst.onTimePercent ?? 100) < 80 && worst.userId !== best.userId) {
      insights.push({
        color: 'red',
        text: `${worst.name} is below 80% on-time delivery (${worst.onTimePercent}% across ${worst.totalCompleted} tasks)`,
      })
    }
  }

  if (monthlyOutput.length >= 2) {
    const curr = monthlyOutput[monthlyOutput.length - 1].count
    const prev = monthlyOutput[monthlyOutput.length - 2].count
    if (prev > 0) {
      const change = ((curr - prev) / prev) * 100
      if (change >= 20) {
        insights.push({ color: 'green', text: `Output is up ${Math.round(change)}% this month vs last (${curr} vs ${prev} episodes)` })
      } else if (change <= -20) {
        insights.push({ color: 'amber', text: `Output is down ${Math.round(Math.abs(change))}% this month vs last (${curr} vs ${prev} episodes)` })
      }
    } else if (curr > 0) {
      insights.push({ color: 'green', text: `${curr} episode${curr !== 1 ? 's' : ''} delivered this month — up from 0 last month` })
    }
  }

  if (turnaroundByClient.length >= 2) {
    const avgAll = turnaroundByClient.reduce((s, c) => s + c.avgDays, 0) / turnaroundByClient.length
    const slowest = turnaroundByClient[0]
    if (slowest.avgDays > avgAll + 1) {
      insights.push({
        color: 'amber',
        text: `${slowest.clientLabel} takes the longest to turnaround — ${slowest.avgDays.toFixed(1)}d avg vs ${avgAll.toFixed(1)}d studio avg`,
      })
    }
  }

  if ((overdueCount ?? 0) > 0) {
    insights.push({
      color: 'red',
      text: `${overdueCount} episode${(overdueCount ?? 0) !== 1 ? 's are' : ' is'} more than 7 days past release date`,
    })
  }

  const data = {
    monthlyOutput,
    outputByClient,
    revisionByClient,
    teamCompletion,
    turnaroundByClient,
    insights,
  }

  cache.set(cacheKey, { data, ts: Date.now() })
  return NextResponse.json(data)
}

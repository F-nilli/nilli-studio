import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns'

export async function GET(req: NextRequest) {
  // Auth check — only admin + ops_manager
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'ops_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const monthParam = searchParams.get('month') // 'YYYY-MM'

  if (!userId || !monthParam) {
    return NextResponse.json({ error: 'Missing userId or month' }, { status: 400 })
  }

  const [year, month] = monthParam.split('-').map(Number)
  const monthDate = new Date(year, month - 1, 1)

  const admin = createAdminClient()

  // Helper: fetch metrics for a given month
  async function getMonthMetrics(m: Date) {
    const monthStart = startOfMonth(m).toISOString()
    const monthEnd = endOfMonth(m).toISOString()

    const { data: history } = await admin
      .from('task_history')
      .select('task_id, to_status, changed_by')
      .gte('changed_at', monthStart)
      .lte('changed_at', monthEnd)
      .in('to_status', ['done', 'approved', 'revision'])

    if (!history || history.length === 0) {
      return { completed: 0, reviewed: 0, byTrack: {} }
    }

    const taskIds = [...new Set(history.map((r: { task_id: string }) => r.task_id).filter(Boolean))]
    const { data: tasks } = await admin
      .from('tasks')
      .select('id, assignee_id, track')
      .in('id', taskIds)

    const taskMap: Record<string, { assignee_id: string | null; track: string }> = {}
    for (const t of tasks ?? []) taskMap[t.id] = { assignee_id: t.assignee_id, track: t.track }

    const completedTaskIds = new Set<string>()
    const reviewedTaskIds = new Set<string>()
    const byTrack: Record<string, { completed: number; reviewed: number }> = {}

    for (const row of history) {
      const task = taskMap[row.task_id]
      if (!task) continue
      const track = task.track ?? 'Other'
      if (!byTrack[track]) byTrack[track] = { completed: 0, reviewed: 0 }

      if (task.assignee_id === userId && (row.to_status === 'done' || row.to_status === 'approved') && !completedTaskIds.has(row.task_id)) {
        completedTaskIds.add(row.task_id)
        byTrack[track].completed++
      }
      if (row.changed_by === userId && (row.to_status === 'approved' || row.to_status === 'revision') && task.assignee_id !== userId && !reviewedTaskIds.has(row.task_id)) {
        reviewedTaskIds.add(row.task_id)
        byTrack[track].reviewed++
      }
    }

    return { completed: completedTaskIds.size, reviewed: reviewedTaskIds.size, byTrack }
  }

  // Current month metrics
  const current = await getMonthMetrics(monthDate)

  // 6-month trend
  const trendMonths = Array.from({ length: 6 }, (_, i) => subMonths(monthDate, 5 - i))
  const trend = await Promise.all(trendMonths.map(async m => {
    const { completed, reviewed } = await getMonthMetrics(m)
    return { label: format(m, 'MMM'), month: format(m, 'yyyy-MM'), completed, reviewed }
  }))

  return NextResponse.json({ ...current, trend })
}

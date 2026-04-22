import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAfter, startOfDay, parseISO } from 'date-fns'

// This route can be called by a Vercel cron job daily
// Add to vercel.json: { "crons": [{ "path": "/api/overdue-check", "schedule": "0 9 * * *" }] }

export async function GET(request: Request) {
  // Simple auth check via secret header
  const authHeader = request.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const today = startOfDay(new Date())

  // Find overdue tasks
  const { data: overdueTasks } = await supabase
    .from('tasks')
    .select('*, assignee:users(*), episode:episodes(*)')
    .not('due_date', 'is', null)
    .not('status', 'in', '("approved","done","locked")')

  if (!overdueTasks) return NextResponse.json({ notified: 0 })

  const { data: francis } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'admin')
    .single()

  let notified = 0

  for (const task of overdueTasks) {
    if (!task.due_date) continue
    const dueDate = startOfDay(parseISO(task.due_date))
    if (!isAfter(today, dueDate)) continue

    const assignee = task.assignee
    if (!assignee) continue

    // Check if we already notified today
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('task_id', task.id)
      .eq('type', 'task_overdue')
      .gte('created_at', today.toISOString())
      .single()

    if (existing) continue

    const notifBody = `"${task.label}" is overdue${task.episode ? ` for ${task.episode.guest_name} / ${task.episode.client_label}` : ''}`

    // Notify assignee
    await supabase.from('notifications').insert({
      user_id: assignee.id,
      type: 'task_overdue',
      title: 'Overdue task',
      body: notifBody,
      task_id: task.id,
      episode_id: task.episode_id,
      read: false,
    })

    // Also notify Francis if they're not the assignee
    if (francis && francis.id !== assignee.id) {
      await supabase.from('notifications').insert({
        user_id: francis.id,
        type: 'task_overdue',
        title: `Overdue: ${assignee.name}`,
        body: notifBody,
        task_id: task.id,
        episode_id: task.episode_id,
        read: false,
      })
    }

    notified++
  }

  // Safety-net: unlock any tasks that are still locked but should be in_progress.
  // Catches: (1) dep wiring bug at creation (dep_task_ids = [] but status = locked),
  // (2) missed unlock calls due to network errors or navigation.
  const { data: lockedTasks } = await supabase
    .from('tasks')
    .select('id, dep_task_ids, episode_id')
    .eq('status', 'locked')

  if (lockedTasks) {
    const episodeIds = [...new Set(lockedTasks.map(t => t.episode_id))]
    for (const episodeId of episodeIds) {
      const { data: episodeTasks } = await supabase
        .from('tasks').select('id, status').eq('episode_id', episodeId)
      if (!episodeTasks) continue
      const approvedIds = new Set(
        episodeTasks.filter(t => t.status === 'approved' || t.status === 'done').map(t => t.id)
      )
      const stuck = lockedTasks.filter(t =>
        t.episode_id === episodeId &&
        (t.dep_task_ids.length === 0 || t.dep_task_ids.every((d: string) => approvedIds.has(d)))
      )
      for (const t of stuck) {
        await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', t.id)
      }
    }
  }

  return NextResponse.json({ notified })
}

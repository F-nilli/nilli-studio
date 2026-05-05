import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startOfDay, isAfter, isSameDay } from 'date-fns'
import { sendPushToUser } from '@/lib/push'
import { parseDate } from '@/lib/utils'

// Vercel cron: runs daily at 9 AM UTC
// vercel.json: { "path": "/api/task-notifications-check", "schedule": "0 9 * * *" }

export async function GET(request: Request) {
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

  // Load notification settings
  const { data: settingsRows } = await supabase
    .from('workspace_settings')
    .select('task_notifications')
    .limit(1)

  const taskNotifs = (settingsRows?.[0] as any)?.task_notifications ?? { deadline_reminder: true, overdue: true }
  const reminderEnabled = taskNotifs.deadline_reminder !== false
  const overdueEnabled = taskNotifs.overdue !== false

  if (!reminderEnabled && !overdueEnabled) {
    return NextResponse.json({ skipped: true, reason: 'all notifications disabled' })
  }

  // Load all admin users to notify on overdue
  const { data: admins } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')

  const adminIds = (admins ?? []).map((a: { id: string }) => a.id)

  const today = startOfDay(new Date())

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*, assignee:users!assignee_id(*), episode:episodes(*)')
    .not('due_date', 'is', null)
    .not('status', 'in', '("approved","done","locked")')

  if (!tasks) return NextResponse.json({ reminded: 0, overdue: 0 })

  let reminded = 0
  let overdueCount = 0

  for (const task of tasks) {
    if (!task.due_date || !task.assignee) continue
    const dueDate = startOfDay(parseDate(task.due_date))
    const isDueToday = isSameDay(dueDate, today)
    const isPastDue = isAfter(today, dueDate)

    const episodeSuffix = task.episode
      ? ` for ${task.episode.guest_name} / ${task.episode.client_label}`
      : ''

    // ── Deadline reminder (due today) ───────────────────────────────────────
    if (reminderEnabled && isDueToday) {
      const { data: existingReminder } = await supabase
        .from('notifications')
        .select('id')
        .eq('task_id', task.id)
        .eq('type', 'task_deadline_reminder')
        .gte('created_at', today.toISOString())
        .single()

      if (!existingReminder) {
        const notifBody = `"${task.label}" is due today${episodeSuffix}`

        await supabase.from('notifications').insert({
          user_id: task.assignee.id,
          type: 'task_deadline_reminder',
          title: 'Task due today',
          body: notifBody,
          task_id: task.id,
          episode_id: task.episode_id,
          read: false,
        })

        await sendPushToUser(task.assignee.id, {
          title: 'Task due today',
          body: notifBody,
          url: task.episode_id ? `/episodes/${task.episode_id}` : '/',
          tag: 'task_deadline_reminder',
        })

        reminded++
      }
    }

    // ── Overdue notification ────────────────────────────────────────────────
    if (overdueEnabled && isPastDue) {
      const { data: existingOverdue } = await supabase
        .from('notifications')
        .select('id')
        .eq('task_id', task.id)
        .eq('type', 'task_overdue')
        .gte('created_at', today.toISOString())
        .single()

      if (!existingOverdue) {
        const notifBody = `"${task.label}" is overdue${episodeSuffix}`

        await supabase.from('notifications').insert({
          user_id: task.assignee.id,
          type: 'task_overdue',
          title: 'Overdue task',
          body: notifBody,
          task_id: task.id,
          episode_id: task.episode_id,
          read: false,
        })

        await sendPushToUser(task.assignee.id, {
          title: 'Overdue task',
          body: notifBody,
          url: task.episode_id ? `/episodes/${task.episode_id}` : '/',
          tag: 'task_overdue',
        })

        // Notify all admins (except if the assignee is an admin themselves)
        for (const adminId of adminIds) {
          if (adminId === task.assignee.id) continue
          await supabase.from('notifications').insert({
            user_id: adminId,
            type: 'task_overdue',
            title: `Overdue: ${task.assignee.name}`,
            body: notifBody,
            task_id: task.id,
            episode_id: task.episode_id,
            read: false,
          })
          await sendPushToUser(adminId, {
            title: `Overdue: ${task.assignee.name}`,
            body: notifBody,
            url: task.episode_id ? `/episodes/${task.episode_id}` : '/',
            tag: 'task_overdue',
          })
        }

        overdueCount++
      }
    }
  }

  return NextResponse.json({ reminded, overdue: overdueCount })
}

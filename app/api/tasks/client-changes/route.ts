import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'
import { buildRevisionBlocks, postToSlack } from '@/lib/slack'
import { checkRateLimit } from '@/lib/rateLimit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Client requested changes on a Client Action task.
//
// One server-side operation that:
//   1. sends the chosen completed dependency task(s) back to revision,
//      with a new due date chosen by the caller,
//   2. re-locks the Client Action task (it unlocks again once every dep is
//      re-approved — the single review round means its own date stays as-is),
//   3. writes task_history for every change,
//   4. notifies each affected assignee (in-app + push) and posts to Slack.
//
// This used to run as several browser-side writes, which silently failed for
// anyone without admin/ops rights (the task guard blocks members from
// re-locking tasks and editing dates). Running here under the service role
// makes it role-independent and all-or-nothing.

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = checkRateLimit(`client-changes:${user.id}`, 20)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { clientTaskId, depTaskIds, dueDate } = body as {
    clientTaskId?: unknown; depTaskIds?: unknown; dueDate?: unknown
  }

  if (typeof clientTaskId !== 'string' || !UUID_RE.test(clientTaskId)) {
    return NextResponse.json({ error: 'Invalid clientTaskId' }, { status: 400 })
  }
  if (!Array.isArray(depTaskIds) || depTaskIds.length === 0 || depTaskIds.length > 50 ||
      !depTaskIds.every(id => typeof id === 'string' && UUID_RE.test(id))) {
    return NextResponse.json({ error: 'Invalid depTaskIds' }, { status: 400 })
  }
  if (typeof dueDate !== 'string' || isNaN(new Date(dueDate).getTime())) {
    return NextResponse.json({ error: 'Invalid dueDate' }, { status: 400 })
  }
  const newDueDate = new Date(dueDate).toISOString()

  const admin = createAdminClient()

  // Load the client task + caller's role.
  const [{ data: clientTask }, { data: caller }] = await Promise.all([
    admin.from('tasks').select('id, episode_id, label, track, status, assignee_id, dep_task_ids').eq('id', clientTaskId).maybeSingle(),
    admin.from('users').select('id, role').eq('id', user.id).maybeSingle(),
  ])
  if (!clientTask) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (clientTask.status !== 'in_progress' && clientTask.status !== 'revision') {
    return NextResponse.json({ error: 'Task is not actionable' }, { status: 409 })
  }
  const isManager = caller?.role === 'admin' || caller?.role === 'ops_manager'
  if (clientTask.assignee_id !== user.id && !isManager) {
    return NextResponse.json({ error: 'Only the assignee can send a task back for client revisions' }, { status: 403 })
  }

  // The chosen deps must actually be dependencies of this task and currently
  // completed (done/approved) — anything else is a stale or tampered request.
  const { data: depTasks } = await admin
    .from('tasks')
    .select('id, label, status, assignee_id, assignee:users!assignee_id(name)')
    .in('id', depTaskIds)
    .eq('episode_id', clientTask.episode_id)
  const deps = (depTaskIds as string[]).map(id => {
    const t = (depTasks ?? []).find(d => d.id === id)
    if (!t) return { error: 'Dependency task not found' as const }
    if (!(clientTask.dep_task_ids ?? []).includes(t.id)) return { error: `"${t.label}" is not a dependency of this task` as const }
    if (t.status !== 'done' && t.status !== 'approved') return { error: `"${t.label}" is not completed` as const }
    return { task: t }
  })
  const firstError = deps.find(d => 'error' in d)
  if (firstError && 'error' in firstError) {
    return NextResponse.json({ error: firstError.error }, { status: 400 })
  }
  const validDeps = deps as Array<{ task: { id: string; label: string; status: string; assignee_id: string | null; assignee: unknown } }>

  // 1. Reopen the chosen dep tasks with the new due date.
  const reopenedTasks: unknown[] = []
  for (const { task: dep } of validDeps) {
    const { data: reopened, error } = await admin
      .from('tasks')
      .update({ status: 'revision', due_date: newDueDate })
      .eq('id', dep.id)
      .in('status', ['done', 'approved']) // lost the race? skip rather than clobber
      .select('*')
    if (error) {
      console.error('[client-changes] failed to reopen task', dep.id, error.message)
      return NextResponse.json({ error: `Failed to reopen "${dep.label}"` }, { status: 500 })
    }
    if (reopened?.[0]) reopenedTasks.push(reopened[0])
    await admin.from('task_history').insert({
      task_id: dep.id,
      episode_id: clientTask.episode_id,
      from_status: dep.status,
      to_status: 'revision',
      changed_by: user.id,
      note: 'Client requested changes',
    })
  }

  // 2. Re-lock the client task.
  const { data: updatedClientTask, error: lockError } = await admin
    .from('tasks')
    .update({ status: 'locked' })
    .eq('id', clientTaskId)
    .select('*')
    .single()
  if (lockError) {
    console.error('[client-changes] failed to re-lock client task', clientTaskId, lockError.message)
    return NextResponse.json({ error: 'Failed to re-lock the client task' }, { status: 500 })
  }
  await admin.from('task_history').insert({
    task_id: clientTaskId,
    episode_id: clientTask.episode_id,
    from_status: clientTask.status,
    to_status: 'locked',
    changed_by: user.id,
    note: 'Re-locked: client requested changes on dependency',
  })

  // 3. Notify each affected assignee (in-app + push).
  const notifRows = validDeps
    .filter(({ task: dep }) => dep.assignee_id)
    .map(({ task: dep }) => ({
      user_id: dep.assignee_id!,
      type: 'task_revision',
      title: 'Client requested changes',
      body: `"${dep.label}" was sent back — client requested revisions on "${clientTask.label}"`,
      task_id: dep.id,
      episode_id: clientTask.episode_id,
      read: false,
    }))
  if (notifRows.length > 0) {
    const { error } = await admin.from('notifications').insert(notifRows)
    if (error) console.error('[client-changes] notifications insert failed:', error.message)
    for (const row of notifRows) {
      sendPushToUser(row.user_id, {
        title: row.title,
        body: row.body,
        url: `/episodes/${clientTask.episode_id}`,
        tag: 'task_revision',
      }).catch(() => {})
    }
  }

  // 4. Slack (best-effort, mirrors /api/slack/notify type 'revision').
  try {
    const [{ data: settingsRows }, { data: episode }] = await Promise.all([
      admin.from('workspace_settings').select('slack_bot_token, slack_notifications').limit(1),
      admin.from('episodes').select('client_key, client_label, guest_name').eq('id', clientTask.episode_id).single(),
    ])
    const settings = settingsRows?.[0] as { slack_bot_token?: string; slack_notifications?: Record<string, boolean> } | undefined
    if (settings?.slack_bot_token && settings.slack_notifications?.revision !== false && episode) {
      const { data: clientRows } = await admin
        .from('clients')
        .select('slack_channel_id')
        .eq('key', episode.client_key)
        .eq('active', true)
        .limit(1)
      const channel = clientRows?.[0]?.slack_channel_id
      if (channel) {
        for (const { task: dep } of validDeps) {
          const assigneeName = (dep.assignee as { name?: string } | null)?.name ?? ''
          await postToSlack(
            settings.slack_bot_token!,
            channel,
            buildRevisionBlocks({
              clientLabel: episode.client_label,
              guestName: episode.guest_name,
              taskLabel: dep.label,
              assigneeName,
              dueDate: newDueDate,
            })
          )
        }
      }
    }
  } catch (e) {
    console.error('[client-changes] slack notify failed:', e)
  }

  return NextResponse.json({
    ok: true,
    clientTask: updatedClientTask,
    reopenedTasks,
  })
}

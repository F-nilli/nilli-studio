import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'
import { buildRevisionBlocks, postToSlack } from '@/lib/slack'
import { checkRateLimit } from '@/lib/rateLimit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Client corrections: the service-role RPC atomically reopens the selected
// dependencies and locks Client Action. Each correction finishes directly as
// done; the database closes Client Action after the last selected task finishes.
// Notifications run only after that transaction succeeds.

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
  if (clientTask.track !== 'Client Action') return NextResponse.json({ error: 'Not a Client Action task' }, { status: 400 })
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

  // The RPC locks and validates the round, then writes tasks and history atomically.
  const { data: round, error: roundError } = await admin.rpc('start_client_revision_round', {
    p_client_task_id: clientTaskId,
    p_task_ids: depTaskIds,
    p_due_date: newDueDate,
    p_actor: user.id,
  })
  if (roundError) {
    console.error('[client-changes] revision round failed:', roundError.message)
    return NextResponse.json({ error: 'Could not start revisions. Refresh and try again.' }, { status: 409 })
  }
  const updatedClientTask = round.clientTask
  const reopenedTasks = round.reopenedTasks

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

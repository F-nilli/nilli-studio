import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEpisode } from '@/lib/deliver'
import { sendPushToUser } from '@/lib/push'

export async function POST(req: NextRequest) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { episodeId, silent } = await req.json()
  if (!episodeId) return NextResponse.json({ unlocked: 0 })
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(episodeId)) {
    return NextResponse.json({ error: 'Invalid episodeId' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: allTasks } = await supabase.from('tasks').select('*').eq('episode_id', episodeId)
  if (!allTasks) return NextResponse.json({ unlocked: 0 })

  // Authorization: this route runs with the service role, so without a check
  // any signed-in user could unlock tasks and even force auto-archival on
  // episodes they have nothing to do with. The caller must be admin/ops, or
  // an assignee/approver of at least one task on this episode (the normal
  // case: a member completes their task and the app re-checks dependencies).
  const { data: caller } = await sessionClient.from('users').select('role').eq('id', user.id).single()
  const isPrivileged = caller?.role === 'admin' || caller?.role === 'ops_manager'
  if (!isPrivileged) {
    const isInvolved = allTasks.some(t => t.assignee_id === user.id || t.approver_id === user.id)
    if (!isInvolved) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const approvedIds = new Set(
    allTasks.filter(t => t.status === 'approved' || t.status === 'done').map(t => t.id)
  )

  const { data: episode } = await supabase.from('episodes').select('*').eq('id', episodeId).single()

  let unlocked = 0

  for (const t of allTasks) {
    if (t.status !== 'locked') continue
    // A locked task with no dep_task_ids recorded is a creation bug — unlock it immediately
    const shouldUnlock =
      t.dep_task_ids.length === 0 ||
      t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
    if (!shouldUnlock) continue

    await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', t.id)
    unlocked++

    const { data: assignee } = await supabase.from('users').select('*').eq('id', t.assignee_id).single()
    if (assignee) {
      await supabase.from('notifications').insert({
        user_id: assignee.id,
        type: 'task_unlocked',
        title: 'New task started',
        body: `"${t.label}" is now in progress for ${episode ? `${episode.guest_name} / ${episode.client_label}` : ''}`,
        task_id: t.id,
        episode_id: episodeId,
        read: false,
      })
      // Direct server-side push (the old self-HTTP-call had no session
      // cookies, so middleware redirected it to /login and it never sent).
      sendPushToUser(assignee.id, {
        title: 'New task started',
        body: `"${t.label}" is now in progress`,
        url: `/episodes/${episodeId}`,
        tag: 'task_unlocked',
      }).catch(() => {})
    }
  }

  // Auto-archive: if every task on this episode is now done/approved, mark
  // the episode delivered automatically. Skips if the episode is already
  // archived (idempotent inside deliverEpisode).
  let autoArchived = false
  if (episode && !episode.archived && allTasks.length > 0) {
    const allTerminal = allTasks.every(t => t.status === 'done' || t.status === 'approved')
    if (allTerminal) {
      const result = await deliverEpisode(supabase, {
        episodeId,
        deliveredBy: null,
        // Per product spec: when the user issued the original action silently,
        // the auto-archive that cascades from it is also silent.
        silent: Boolean(silent),
      })
      autoArchived = result.ok && !result.alreadyDelivered
    }
  }

  return NextResponse.json({ unlocked, autoArchived })
}

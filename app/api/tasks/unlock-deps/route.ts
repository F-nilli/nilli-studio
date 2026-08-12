import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEpisode } from '@/lib/deliver'
import { unlockReadyTasks } from '@/lib/unlock'

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

  // Authorization: this route runs with the service role, so without a check
  // any signed-in user could unlock tasks and even force auto-archival on
  // episodes they have nothing to do with. The caller must be admin/ops, or
  // an assignee/approver of at least one task on this episode (the normal
  // case: a member completes their task and the app re-checks dependencies).
  const { data: caller } = await sessionClient.from('users').select('role').eq('id', user.id).single()
  const isPrivileged = caller?.role === 'admin' || caller?.role === 'ops_manager'
  if (!isPrivileged) {
    const { data: ownTasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('episode_id', episodeId)
      .or(`assignee_id.eq.${user.id},approver_id.eq.${user.id}`)
      .limit(1)
    if (!ownTasks || ownTasks.length === 0) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // One shared unlock implementation (also used by the cron safety net).
  const { unlocked } = await unlockReadyTasks(supabase, episodeId, { silent: Boolean(silent) })

  // Auto-archive: if every task on this episode is now done/approved, mark
  // the episode delivered automatically. Skips if the episode is already
  // archived (idempotent inside deliverEpisode).
  let autoArchived = false
  const { data: episode } = await supabase
    .from('episodes').select('id, archived').eq('id', episodeId).single()
  if (episode && !episode.archived) {
    const { data: allTasks } = await supabase.from('tasks').select('status').eq('episode_id', episodeId)
    if (allTasks && allTasks.length > 0) {
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
  }

  return NextResponse.json({ unlocked, autoArchived })
}

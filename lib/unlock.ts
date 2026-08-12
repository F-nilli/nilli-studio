import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToUser } from './push'
import { wallTimeInTzToUTC } from './utils'

// ── The one and only server-side unlock implementation ───────────────────────
// Unlock logic used to exist in THREE places that could drift apart:
//   1. the DB trigger trg_unlock_dependent_tasks (fires on status updates),
//   2. this logic inline in /api/tasks/unlock-deps,
//   3. a third copy in /api/overdue-check (the cron safety net).
// Now the two API routes share this module; the DB trigger remains as the
// lowest-level safety net for status updates that bypass these routes, and
// the migration in this batch makes it compute due dates the same way.
//
// Per product spec, a locked task's due date is computed WHEN IT UNLOCKS
// (release date − due_days), not at episode creation — otherwise a long
// upstream phase makes downstream tasks instantly overdue on unlock.

export interface UnlockResult {
  unlocked: number
  unlockedTaskIds: string[]
}

interface UnlockTaskRow {
  id: string
  status: string
  dep_task_ids: string[] | null
  due_date: string | null
  due_days: number | null
  label: string
  assignee_id: string | null
}

export async function unlockReadyTasks(
  supabase: SupabaseClient,
  episodeId: string,
  opts: { silent?: boolean } = {}
): Promise<UnlockResult> {
  const { data: episode } = await supabase
    .from('episodes')
    .select('id, guest_name, client_label, release_date, release_time, archived')
    .eq('id', episodeId)
    .single()
  if (!episode) return { unlocked: 0, unlockedTaskIds: [] }

  const { data: allTasks } = await supabase
    .from('tasks')
    .select('id, status, dep_task_ids, due_date, due_days, label, assignee_id')
    .eq('episode_id', episodeId)
  if (!allTasks) return { unlocked: 0, unlockedTaskIds: [] }

  const tasks = allTasks as UnlockTaskRow[]
  const approvedIds = new Set(tasks.filter(t => t.status === 'approved' || t.status === 'done').map(t => t.id))

  // A locked task with NO dep_task_ids recorded is a creation bug from the
  // old client-side creator — unlock it immediately rather than strand it.
  const toUnlock = tasks.filter(t =>
    t.status === 'locked' &&
    ((t.dep_task_ids ?? []).length === 0 || (t.dep_task_ids ?? []).every(d => approvedIds.has(d)))
  )
  if (toUnlock.length === 0) return { unlocked: 0, unlockedTaskIds: [] }

  // Workspace timezone for due-date computation (canonical value lives in
  // workspace_settings.timezone; falls back to UTC).
  const { data: settingsRows } = await supabase
    .from('workspace_settings')
    .select('timezone')
    .limit(1)
  const tz = (settingsRows?.[0] as { timezone?: string } | undefined)?.timezone || 'UTC'

  const releaseTime = episode.release_time || '09:00'
  const unlockedIds: string[] = []

  for (const t of toUnlock) {
    // Compute the due date at unlock time when the task doesn't have one yet
    // and carries a due_days offset from its template.
    let dueDate = t.due_date
    if (!dueDate && t.due_days !== null && episode.release_date) {
      const release = new Date(`${episode.release_date}T${releaseTime}:00Z`)
      release.setUTCDate(release.getUTCDate() - t.due_days)
      const dateStr = release.toISOString().slice(0, 10)
      dueDate = wallTimeInTzToUTC(dateStr, releaseTime, tz).toISOString()
    }

    const { error } = await supabase
      .from('tasks')
      .update({ status: 'in_progress', ...(dueDate && dueDate !== t.due_date ? { due_date: dueDate } : {}) })
      .eq('id', t.id)
      .eq('status', 'locked') // lost the race? someone else unlocked it — skip
    if (error) {
      console.error(`[unlock] failed to unlock task ${t.id}:`, error.message)
      continue
    }
    unlockedIds.push(t.id)
  }

  if (unlockedIds.length === 0) return { unlocked: 0, unlockedTaskIds: [] }

  // Notifications + push for the newly-unlocked tasks' assignees.
  if (!opts.silent) {
    const notifRows = toUnlock
      .filter(t => unlockedIds.includes(t.id) && t.assignee_id)
      .map(t => ({
        user_id: t.assignee_id!,
        type: 'task_unlocked',
        title: 'New task started',
        body: `"${t.label}" is now in progress for ${episode.guest_name} / ${episode.client_label}`,
        task_id: t.id,
        episode_id: episodeId,
        read: false,
      }))
    if (notifRows.length > 0) {
      const { error } = await supabase.from('notifications').insert(notifRows)
      if (error) console.error('[unlock] notifications insert failed:', error.message)
      for (const t of toUnlock) {
        if (!unlockedIds.includes(t.id) || !t.assignee_id) continue
        sendPushToUser(t.assignee_id, {
          title: 'New task started',
          body: `"${t.label}" is now in progress`,
          url: `/episodes/${episodeId}`,
          tag: 'task_unlocked',
        }).catch(() => {})
      }
    }
  }

  return { unlocked: unlockedIds.length, unlockedTaskIds: unlockedIds }
}

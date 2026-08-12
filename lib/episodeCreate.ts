import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToUser } from './push'

// ── Server-side, all-or-nothing episode creation ─────────────────────────────
// Previously the browser created an episode in 3+N separate writes (episode →
// tasks without deps → one update per task to wire deps → one insert per
// notification). A network drop in the middle left orphan episodes or
// unwired dependencies (the "locked task with no deps" creation bug the
// unlock routes had to special-case).
//
// Here every task id is generated up front so dep_task_ids can be wired in
// ONE bulk insert, and if the task insert fails the episode row is deleted
// again (public.tasks cascades from public.episodes), so the database never
// contains a half-created project.

export interface EpisodeTaskInput {
  seqId: number
  label: string
  assigneeId: string
  track: string
  depSeqIds: number[]
  requiresApproval: boolean
  approverId: string | null
  // ISO timestamp. Meaningful for starting (dependency-free) tasks and for
  // custom tasks with an explicit date. Locked tasks should pass null —
  // their due date is computed when they unlock, from dueDays.
  dueDate: string | null
  // Days-before-release offset from the template, carried on the task so the
  // unlock path can compute the due date at unlock time (product spec).
  dueDays: number | null
  note: string | null
  // Deliverable count from the template (defaults to 1 in the DB).
  quantity?: number
}

export interface CreateEpisodeInput {
  clientKey: string
  clientLabel: string
  guestName: string
  releaseDate: string // 'yyyy-MM-dd'
  releaseTime: string | null // 'HH:mm'
  footageUrl: string | null
  notes: string | null
  templateName: string
  createdBy: string
  sourceEpisodeId?: string | null
  tasks: EpisodeTaskInput[]
  // Notify starting-task assignees (inbox + push). Default true.
  notify?: boolean
}

export type CreateEpisodeResult =
  | { ok: true; episodeId: string }
  | { ok: false; error: string; code?: string }

export async function createEpisodeWithTasks(
  supabase: SupabaseClient,
  input: CreateEpisodeInput
): Promise<CreateEpisodeResult> {
  // 1. Episode row
  const { data: episode, error: epError } = await supabase
    .from('episodes')
    .insert({
      client_key: input.clientKey,
      client_label: input.clientLabel,
      guest_name: input.guestName,
      release_date: input.releaseDate,
      release_time: input.releaseTime,
      footage_url: input.footageUrl,
      notes: input.notes,
      template_name: input.templateName,
      created_by: input.createdBy,
      ...(input.sourceEpisodeId ? { source_episode_id: input.sourceEpisodeId } : {}),
    })
    .select()
    .single()

  if (epError || !episode) {
    return { ok: false, error: epError?.message || 'Failed to create episode', code: epError?.code }
  }

  // 2. Tasks — ids generated up front so dependencies are wired in the same
  // single insert (no per-task update pass).
  const seqIdToDbId: Record<number, string> = {}
  for (const t of input.tasks) seqIdToDbId[t.seqId] = crypto.randomUUID()

  const taskRows = input.tasks.map(t => {
    const depDbIds = t.depSeqIds.map(id => seqIdToDbId[id]).filter(Boolean)
    if (depDbIds.length !== t.depSeqIds.length) {
      console.error(`[episodeCreate] dep wiring mismatch for seq ${t.seqId}: expected ${t.depSeqIds.length}, resolved ${depDbIds.length}`)
    }
    const isStarting = t.depSeqIds.length === 0
    return {
      id: seqIdToDbId[t.seqId],
      episode_id: episode.id,
      template_task_id: t.seqId,
      label: t.label,
      assignee_id: t.assigneeId,
      track: t.track,
      status: isStarting ? 'in_progress' : 'locked',
      due_date: isStarting || t.dueDays === null ? t.dueDate : null,
      due_days: t.dueDays,
      note: t.note,
      quantity: t.quantity ?? 1,
      dep_task_ids: depDbIds,
      requires_approval: t.requiresApproval,
      approver_id: t.approverId,
    }
  })

  const { error: tasksError } = await supabase.from('tasks').insert(taskRows)
  if (tasksError) {
    // Compensating delete — never leave an episode without its tasks.
    await supabase.from('episodes').delete().eq('id', episode.id)
    return { ok: false, error: tasksError.message || 'Failed to create tasks', code: tasksError.code }
  }

  // 3. Starting-task notifications (non-fatal on failure — the project exists,
  //    an inbox item can be regenerated).
  const starting = taskRows.filter(t => t.status === 'in_progress' && t.assignee_id)
  if (starting.length > 0 && input.notify !== false) {
    const { error: notifError } = await supabase.from('notifications').insert(
      starting.map(t => ({
        user_id: t.assignee_id,
        type: 'task_unlocked',
        title: 'New task started',
        body: `"${t.label}" is now in progress for ${input.guestName} / ${input.clientLabel}`,
        task_id: t.id,
        episode_id: episode.id,
        read: false,
      }))
    )
    if (notifError) {
      console.error('[episodeCreate] starting-task notifications failed:', notifError.message)
    }
    for (const t of starting) {
      sendPushToUser(t.assignee_id, {
        title: 'New task started',
        body: `"${t.label}" is now in progress`,
        url: `/episodes/${episode.id}`,
        tag: 'task_unlocked',
      }).catch(() => {})
    }
  }

  return { ok: true, episodeId: episode.id }
}

// Resolve a template approver value (UUID or legacy name string) to a user id.
export function resolveApproverId(
  raw: string | null,
  users: { id: string; name: string }[]
): string | null {
  if (!raw) return null
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return raw
  const match = users.find(u => u.name.toLowerCase() === raw.toLowerCase())
  if (!match) console.warn(`[episodeCreate] approver '${raw}' not found in users table`)
  return match?.id ?? null
}

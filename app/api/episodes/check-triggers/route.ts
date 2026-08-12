import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { addDays, parseISO, format, subDays } from 'date-fns'
import { createEpisodeWithTasks, resolveApproverId } from '@/lib/episodeCreate'
import { wallTimeInTzToUTC } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Authz note: this endpoint is intentionally callable by any logged-in user
  // — it runs as part of the normal member workflow (completing a task can
  // spawn the next pipeline). It is safe because (a) a trigger only fires
  // when the underlying task is genuinely approved/done — which the
  // guard_task_update trigger now enforces at the database level — and
  // (b) spawning is idempotent via the episodes_source_episode_template_unique
  // index, so races and replays can't create duplicates.

  const { taskId, episodeId } = await req.json()
  if (!taskId || !episodeId) return NextResponse.json({ triggered: false })

  const supabase = createAdminClient()

  // Get the task that was just approved
  const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).single()
  if (!task || (task.status !== 'approved' && task.status !== 'done')) return NextResponse.json({ triggered: false })

  // Get the source episode
  const { data: episode } = await supabase.from('episodes').select('*').eq('id', episodeId).single()
  if (!episode) return NextResponse.json({ triggered: false })

  // Only fire triggers from non-spawned episodes (no chains)
  if (episode.source_episode_id) return NextResponse.json({ triggered: false })

  // Find the client by key
  const { data: client } = await supabase.from('clients').select('id').eq('key', episode.client_key).single()
  if (!client) return NextResponse.json({ triggered: false })

  // Load all triggers for this client
  const { data: allTriggers } = await supabase.from('pipeline_triggers').select('*').eq('client_id', client.id)
  if (!allTriggers || allTriggers.length === 0) return NextResponse.json({ triggered: false })

  // Load all tasks for this episode (for on_project check)
  const { data: episodeTasks } = await supabase.from('tasks').select('id, status').eq('episode_id', episodeId)
  if (!episodeTasks) return NextResponse.json({ triggered: false })

  const spawned: string[] = []

  for (const trigger of allTriggers) {
    // Check if this trigger's pipeline was already spawned for this episode
    const { data: existing } = await supabase
      .from('episodes')
      .select('id')
      .eq('source_episode_id', episodeId)
      .eq('template_name', trigger.template_name)
      .maybeSingle()
    if (existing) continue

    // Check trigger condition
    let shouldFire = false
    if (trigger.trigger_type === 'on_task') {
      shouldFire = task.template_task_id === trigger.trigger_seq_id
    } else if (trigger.trigger_type === 'on_project') {
      // Re-check with the current task already counted as approved
      const allApproved = episodeTasks.every(t => t.id === taskId || t.status === 'approved' || t.status === 'done')
      shouldFire = allApproved
    }
    if (!shouldFire) continue

    // Load templates for the triggered pipeline
    const { data: pipelineTemplates } = await supabase
      .from('task_templates')
      .select('*')
      .eq('client_id', client.id)
      .eq('template_name', trigger.template_name)
      .order('seq_id', { ascending: true })
    if (!pipelineTemplates || pipelineTemplates.length === 0) continue

    // Load all users for approver_id resolution (UUID or name fallback)
    const { data: allUsers } = await supabase.from('users').select('id, name')

    // Workspace timezone for due-date computation
    const { data: settingsRows } = await supabase.from('workspace_settings').select('timezone').limit(1)
    const tz = (settingsRows?.[0] as { timezone?: string } | undefined)?.timezone || 'UTC'

    // Calculate new release date
    const newReleaseDate = format(
      addDays(parseISO(episode.release_date), trigger.offset_days),
      'yyyy-MM-dd'
    )

    // Due date for starting (dep-free) tasks: release − due_days at 09:00
    // workspace time. Locked tasks get theirs computed when they unlock.
    const spawnDueDate = (dueDays: number | null): string | null => {
      if (dueDays === null) return null
      const d = subDays(parseISO(newReleaseDate), dueDays)
      return wallTimeInTzToUTC(format(d, 'yyyy-MM-dd'), '09:00', tz).toISOString()
    }

    // Create episode + tasks atomically via the shared creator (dep wiring
    // happens in a single bulk insert; on task failure the episode is
    // deleted again — no half-created pipelines).
    const result = await createEpisodeWithTasks(supabase, {
      clientKey: episode.client_key,
      clientLabel: episode.client_label,
      guestName: `${episode.guest_name} (${trigger.template_name})`,
      releaseDate: newReleaseDate,
      releaseTime: null,
      footageUrl: episode.footage_url,
      notes: episode.notes,
      templateName: trigger.template_name,
      sourceEpisodeId: episodeId,
      createdBy: episode.created_by,
      tasks: pipelineTemplates.map((t: { seq_id: number; label: string; assignee_id: string | null; track: string; dep_seq_ids: number[]; requires_approval: boolean; approver_id: string | null; due_days: number | null; note: string | null }) => ({
        seqId: t.seq_id,
        label: t.label,
        assigneeId: t.assignee_id || episode.created_by,
        track: t.track,
        depSeqIds: t.dep_seq_ids ?? [],
        requiresApproval: t.requires_approval || false,
        approverId: t.requires_approval ? resolveApproverId(t.approver_id, allUsers ?? []) : null,
        dueDate: (t.dep_seq_ids ?? []).length === 0 ? spawnDueDate(t.due_days ?? null) : null,
        dueDays: t.due_days ?? null,
        note: t.note || null,
      })),
    })

    if (!result.ok) {
      // Unique-violation (23505) = a concurrent call already spawned this
      // exact pipeline for this episode. That's the idempotency guard doing
      // its job — treat as "already spawned" and move on.
      if (result.code === '23505') continue
      console.error('[check-triggers] episode spawn failed:', result.error)
      continue
    }

    spawned.push(result.episodeId)
  }

  return NextResponse.json({ triggered: spawned.length > 0, spawned })
}

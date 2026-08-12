import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { addDays, parseISO, format, subDays } from 'date-fns'

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

    // Calculate new release date
    const newReleaseDate = format(
      addDays(parseISO(episode.release_date), trigger.offset_days),
      'yyyy-MM-dd'
    )

    // Calculate due dates (same D-X logic as NewEpisodeClient)
    const fixedTasks = pipelineTemplates.filter((t: { due_days: number | null }) => t.due_days !== null)
    const dueDates: Record<number, string> = {}
    if (fixedTasks.length > 0) {
      const release = parseISO(newReleaseDate)
      const maxDays = Math.max(...fixedTasks.map((t: { due_days: number }) => t.due_days))
      for (const t of fixedTasks) {
        const d = subDays(release, maxDays - t.due_days)
        d.setHours(9, 0, 0, 0)
        dueDates[t.seq_id] = d.toISOString()
      }
    }

    // Create the new episode
    const { data: newEpisode, error: spawnError } = await supabase.from('episodes').insert({
      client_key: episode.client_key,
      client_label: episode.client_label,
      guest_name: `${episode.guest_name} (${trigger.template_name})`,
      release_date: newReleaseDate,
      footage_url: episode.footage_url,
      notes: episode.notes,
      template_name: trigger.template_name,
      source_episode_id: episodeId,
      created_by: episode.created_by,
    }).select().single()

    if (spawnError) {
      // Unique-violation (23505) = a concurrent call already spawned this
      // exact pipeline for this episode. That's the idempotency guard doing
      // its job — treat as "already spawned" and move on.
      if (spawnError.code === '23505') continue
      console.error('[check-triggers] episode spawn failed:', spawnError.message)
      continue
    }
    if (!newEpisode) continue

    // Create tasks
    const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)

    const taskInserts = pipelineTemplates.map((t: { seq_id: number; label: string; assignee_id: string | null; track: string; dep_seq_ids: number[]; requires_approval: boolean; approver_id: string | null; note: string | null }) => {
      let resolvedApproverId: string | null = null
      if (t.requires_approval && t.approver_id) {
        if (isUuid(t.approver_id)) {
          resolvedApproverId = t.approver_id
        } else {
          const match = (allUsers || []).find(u => u.name.toLowerCase() === t.approver_id!.toLowerCase())
          if (match) resolvedApproverId = match.id
          else console.warn(`check-triggers: approver '${t.approver_id}' not found for task '${t.label}'`)
        }
      }
      return {
        episode_id: newEpisode.id,
        template_task_id: t.seq_id,
        label: t.label,
        assignee_id: t.assignee_id || episode.created_by,
        track: t.track,
        status: t.dep_seq_ids.length === 0 ? 'in_progress' : 'locked',
        due_date: dueDates[t.seq_id] || null,
        note: t.note || null,
        dep_task_ids: [],
        requires_approval: t.requires_approval || false,
        approver_id: resolvedApproverId,
      }
    })

    const { data: createdTasks } = await supabase.from('tasks').insert(taskInserts).select()
    if (!createdTasks) continue

    // Wire dep_task_ids
    const seqIdToDbId: Record<number, string> = {}
    for (const t of createdTasks) seqIdToDbId[t.template_task_id] = t.id

    for (const template of pipelineTemplates) {
      if (template.dep_seq_ids.length > 0) {
        const depDbIds = template.dep_seq_ids.map((d: number) => seqIdToDbId[d]).filter(Boolean)
        await supabase.from('tasks').update({ dep_task_ids: depDbIds }).eq('id', seqIdToDbId[template.seq_id])
      }
    }

    spawned.push(newEpisode.id)
  }

  return NextResponse.json({ triggered: spawned.length > 0, spawned })
}

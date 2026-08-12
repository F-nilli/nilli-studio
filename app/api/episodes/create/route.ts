import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createEpisodeWithTasks, resolveApproverId, type EpisodeTaskInput } from '@/lib/episodeCreate'
import { wallTimeInTzToUTC } from '@/lib/utils'

// POST /api/episodes/create — server-side, all-or-nothing project creation.
// Only admins/ops managers may create projects (mirrors canCreateProject and
// the tasks INSERT policy from migration_task_workflow_rls.sql). The browser
// used to do 3+N separate writes; see lib/episodeCreate.ts for why that moved.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const TZ_RE = /^[A-Za-z_]+\/[A-Za-z_]+|^UTC$/
const TRACKS = ['Long-form', 'Trailer', 'Thumbnails', 'Clips & Shorts', 'Review', 'Publishing', 'Client Action']

interface CustomTaskPayload {
  tmpId: number
  label: string
  track: string
  assignee_id: string | null
  due_date: string | null // datetime-local wall clock
  dep_tmp_ids: number[]
  requires_approval: boolean
  approver_id: string | null // UUID or name
}

export async function POST(req: NextRequest) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await sessionClient.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin' && profile?.role !== 'ops_manager') {
    return NextResponse.json({ error: 'Only admins and ops managers can create projects' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    clientId, guestName, releaseDate, releaseTime, footageUrl, notes,
    templateName, dueDateOverrides, customTasks, browserTimezone,
  } = body as {
    clientId?: string
    guestName?: string
    releaseDate?: string
    releaseTime?: string | null
    footageUrl?: string | null
    notes?: string | null
    templateName?: string
    dueDateOverrides?: Record<string, string> // seqId → datetime-local wall clock
    customTasks?: CustomTaskPayload[]
    browserTimezone?: string
  }

  // ── Scalar validation ──────────────────────────────────────────────────────
  if (!clientId || !UUID_RE.test(clientId)) {
    return NextResponse.json({ error: 'Valid clientId is required' }, { status: 400 })
  }
  if (!guestName || typeof guestName !== 'string' || guestName.trim().length === 0 || guestName.length > 200) {
    return NextResponse.json({ error: 'guestName is required (max 200 chars)' }, { status: 400 })
  }
  if (!releaseDate || !DATE_RE.test(releaseDate)) {
    return NextResponse.json({ error: 'releaseDate must be yyyy-MM-dd' }, { status: 400 })
  }
  if (releaseTime != null && !TIME_RE.test(releaseTime)) {
    return NextResponse.json({ error: 'releaseTime must be HH:mm' }, { status: 400 })
  }
  if (!templateName || typeof templateName !== 'string' || templateName.length > 100) {
    return NextResponse.json({ error: 'templateName is required' }, { status: 400 })
  }
  if (footageUrl != null && (typeof footageUrl !== 'string' || footageUrl.length > 500)) {
    return NextResponse.json({ error: 'footageUrl too long' }, { status: 400 })
  }
  if (notes != null && (typeof notes !== 'string' || notes.length > 5000)) {
    return NextResponse.json({ error: 'notes too long' }, { status: 400 })
  }
  const tz = browserTimezone && TZ_RE.test(browserTimezone) ? browserTimezone : 'UTC'

  const admin = createAdminClient()

  // ── Client lookup (id → key/label, never trust client-sent strings) ────────
  const { data: client } = await admin
    .from('clients')
    .select('id, key, label')
    .eq('id', clientId)
    .single()
  if (!client) return NextResponse.json({ error: 'Unknown client' }, { status: 400 })

  const { data: allUsers } = await admin.from('users').select('id, name')
  const users = allUsers ?? []
  const validUserIds = new Set(users.map(u => u.id))

  // Convert a datetime-local wall clock (browser tz) to a UTC ISO string.
  const wallToISO = (v: string): string | null => {
    if (!DATETIME_LOCAL_RE.test(v)) return null
    return wallTimeInTzToUTC(v.slice(0, 10), v.slice(11, 16), tz).toISOString()
  }

  let tasks: EpisodeTaskInput[]

  if (templateName === 'custom') {
    // ── Custom pipeline: explicit task list ──────────────────────────────────
    if (!Array.isArray(customTasks) || customTasks.length === 0 || customTasks.length > 100) {
      return NextResponse.json({ error: 'customTasks must contain 1–100 tasks' }, { status: 400 })
    }
    const tmpIds = new Set<number>()
    for (const ct of customTasks) {
      if (!ct || typeof ct.tmpId !== 'number' || tmpIds.has(ct.tmpId)) {
        return NextResponse.json({ error: 'Invalid or duplicate tmpId in customTasks' }, { status: 400 })
      }
      tmpIds.add(ct.tmpId)
      if (!ct.label || typeof ct.label !== 'string' || ct.label.trim().length === 0 || ct.label.length > 200) {
        return NextResponse.json({ error: 'Every task needs a name (max 200 chars)' }, { status: 400 })
      }
      if (!TRACKS.includes(ct.track)) {
        return NextResponse.json({ error: `Unknown track: ${ct.track}` }, { status: 400 })
      }
      if (ct.assignee_id != null && (!UUID_RE.test(ct.assignee_id) || !validUserIds.has(ct.assignee_id))) {
        return NextResponse.json({ error: 'Unknown assignee' }, { status: 400 })
      }
      if (!Array.isArray(ct.dep_tmp_ids)) {
        return NextResponse.json({ error: 'dep_tmp_ids must be an array' }, { status: 400 })
      }
      if (ct.due_date != null && ct.due_date !== '' && !DATETIME_LOCAL_RE.test(ct.due_date)) {
        return NextResponse.json({ error: 'due_date must be datetime-local' }, { status: 400 })
      }
    }
    for (const ct of customTasks) {
      if (ct.dep_tmp_ids.some(d => typeof d !== 'number' || !tmpIds.has(d))) {
        return NextResponse.json({ error: 'Dependencies must reference tasks in this list' }, { status: 400 })
      }
      if (ct.dep_tmp_ids.includes(ct.tmpId)) {
        return NextResponse.json({ error: 'A task cannot depend on itself' }, { status: 400 })
      }
    }
    // Cycle check: a dependency cycle would leave every task in it locked
    // forever. Topological sort — if not all tasks resolve, there's a cycle.
    {
      const resolved = new Set<number>()
      let progressed = true
      while (progressed) {
        progressed = false
        for (const ct of customTasks) {
          if (!resolved.has(ct.tmpId) && ct.dep_tmp_ids.every(d => resolved.has(d))) {
            resolved.add(ct.tmpId)
            progressed = true
          }
        }
      }
      if (resolved.size !== customTasks.length) {
        return NextResponse.json({ error: 'Task dependencies contain a cycle' }, { status: 400 })
      }
    }

    tasks = customTasks.map(ct => ({
      seqId: ct.tmpId,
      label: ct.label.trim(),
      assigneeId: ct.assignee_id || user.id,
      track: ct.track,
      depSeqIds: ct.dep_tmp_ids,
      requiresApproval: Boolean(ct.requires_approval),
      approverId: ct.requires_approval ? resolveApproverId(ct.approver_id, users) : null,
      dueDate: ct.due_date ? wallToISO(ct.due_date) : null,
      dueDays: null,
      note: null,
    }))
  } else {
    // ── Template pipeline: tasks come from the DB templates, never the client.
    // The client may only override due dates of starting (dep-free) tasks.
    // NOTE: templates with template_name NULL are the 'Default' pipeline
    // (same semantics as the UI's `template_name || 'Default'`).
    const { data: clientTemplateRows } = await admin
      .from('task_templates')
      .select('*')
      .eq('client_id', client.id)
      .order('seq_id', { ascending: true })
    const templates = (clientTemplateRows ?? []).filter(
      t => (t.template_name || 'Default') === templateName
    )
    if (templates.length === 0) {
      return NextResponse.json({ error: `No template '${templateName}' for this client` }, { status: 400 })
    }

    const overrides = dueDateOverrides && typeof dueDateOverrides === 'object' ? dueDateOverrides : {}
    const overrideISO: Record<number, string> = {}
    for (const [k, v] of Object.entries(overrides)) {
      const seqId = Number(k)
      if (!Number.isInteger(seqId) || typeof v !== 'string') continue
      const iso = wallToISO(v)
      if (iso) overrideISO[seqId] = iso
    }

    tasks = templates.map(t => ({
      seqId: t.seq_id,
      label: t.label,
      assigneeId: t.assignee_id && validUserIds.has(t.assignee_id) ? t.assignee_id : user.id,
      track: t.track,
      depSeqIds: t.dep_seq_ids ?? [],
      requiresApproval: Boolean(t.requires_approval),
      approverId: t.requires_approval ? resolveApproverId(t.approver_id, users) : null,
      // Only starting tasks carry a due date at creation; locked tasks get
      // theirs computed at unlock time from dueDays.
      dueDate: (t.dep_seq_ids ?? []).length === 0 ? (overrideISO[t.seq_id] ?? null) : null,
      dueDays: t.due_days ?? null,
      note: t.note || null,
      quantity: t.quantity ?? 1,
    }))
  }

  const result = await createEpisodeWithTasks(admin, {
    clientKey: client.key,
    clientLabel: client.label,
    guestName: guestName.trim(),
    releaseDate,
    releaseTime: releaseTime ?? null,
    footageUrl: footageUrl || null,
    notes: notes || null,
    templateName,
    createdBy: user.id,
    tasks,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ episodeId: result.episodeId })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateApiKey } from '@/lib/apiKeys'

export const dynamic = 'force-dynamic'

// GET /api/v1/episodes/:id
// Auth: Authorization: Bearer <api key>
//
// Returns one episode plus its tasks. Read-only, same field exclusions as
// the list endpoint (see /api/v1/episodes). Task notes and internal
// approval wiring are excluded too — only what's useful for tracking
// pipeline progress from outside the app.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = await validateApiKey(req)
  if (!apiKey) return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: episode, error } = await admin
    .from('episodes')
    .select('id, client_key, client_label, guest_name, release_date, release_time, published, published_at, archived, completed_at, created_at')
    .eq('id', id)
    .single()

  if (error || !episode) return NextResponse.json({ error: 'Episode not found' }, { status: 404 })

  const { data: tasks } = await admin
    .from('tasks')
    .select('id, label, track, status, due_date, assignee:users!assignee_id(name)')
    .eq('episode_id', id)
    .order('template_task_id', { ascending: true })

  return NextResponse.json({
    episode: {
      ...episode,
      status: episode.archived ? 'delivered' : 'in_production',
    },
    tasks: (tasks || []).map(t => ({
      id: t.id,
      label: t.label,
      track: t.track,
      status: t.status,
      due_date: t.due_date,
      assignee_name: (t.assignee as unknown as { name: string } | null)?.name ?? null,
    })),
  })
}

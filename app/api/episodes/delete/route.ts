import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'ops_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { ids } = await req.json()
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'No episode IDs provided' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Get all task IDs for these episodes (needed for comment deletion)
  const { data: taskData, error: taskFetchErr } = await admin
    .from('tasks').select('id').in('episode_id', ids)
  if (taskFetchErr) {
    console.error('[delete] Failed to fetch tasks:', taskFetchErr.message)
    return NextResponse.json({ error: taskFetchErr.message }, { status: 500 })
  }
  const taskIds = (taskData || []).map((t: { id: string }) => t.id)

  // Delete in dependency order
  const { error: e1 } = await admin.from('message_notifications').delete().in('episode_id', ids)
  if (e1) { console.error('[delete] message_notifications:', e1.message); return NextResponse.json({ error: e1.message }, { status: 500 }) }

  const { error: e2 } = await admin.from('comment_reads').delete().in('episode_id', ids)
  if (e2) { console.error('[delete] comment_reads:', e2.message); return NextResponse.json({ error: e2.message }, { status: 500 }) }

  if (taskIds.length > 0) {
    const { error: e3 } = await admin.from('comments').delete().in('task_id', taskIds)
    if (e3) { console.error('[delete] comments by task:', e3.message); return NextResponse.json({ error: e3.message }, { status: 500 }) }
  }

  const { error: e4 } = await admin.from('comments').delete().in('episode_id', ids)
  if (e4) { console.error('[delete] comments by episode:', e4.message); return NextResponse.json({ error: e4.message }, { status: 500 }) }

  const { error: e5 } = await admin.from('task_history').delete().in('episode_id', ids)
  if (e5) { console.error('[delete] task_history:', e5.message); return NextResponse.json({ error: e5.message }, { status: 500 }) }

  const { error: e6 } = await admin.from('episode_images').delete().in('episode_id', ids)
  if (e6) { console.error('[delete] episode_images:', e6.message); return NextResponse.json({ error: e6.message }, { status: 500 }) }

  const { error: e7 } = await admin.from('notifications').delete().in('episode_id', ids)
  if (e7) { console.error('[delete] notifications:', e7.message); return NextResponse.json({ error: e7.message }, { status: 500 }) }

  const { error: e8 } = await admin.from('activity_log').delete().in('episode_id', ids)
  if (e8) { console.error('[delete] activity_log:', e8.message); return NextResponse.json({ error: e8.message }, { status: 500 }) }

  const { error: e9 } = await admin.from('tasks').delete().in('episode_id', ids)
  if (e9) { console.error('[delete] tasks:', e9.message); return NextResponse.json({ error: e9.message }, { status: 500 }) }

  const { error: e10 } = await admin.from('episodes').delete().in('id', ids)
  if (e10) { console.error('[delete] episodes:', e10.message); return NextResponse.json({ error: e10.message }, { status: 500 }) }

  console.log(`[delete] Successfully deleted episodes [${ids.join(', ')}] and all related records`)
  return NextResponse.json({ success: true })
}

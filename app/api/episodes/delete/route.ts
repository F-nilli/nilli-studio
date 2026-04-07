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

  function isSchemaCacheError(err: { message: string } | null) {
    return err?.message.includes('schema cache') ?? false
  }

  // Delete in dependency order — schema cache errors are warnings, not failures
  const { error: e1 } = await admin.from('message_notifications').delete().in('episode_id', ids)
  if (e1 && !isSchemaCacheError(e1)) { console.error('[delete] message_notifications:', e1.message); return NextResponse.json({ error: e1.message }, { status: 500 }) }
  if (e1) console.warn('[delete] message_notifications skipped (schema cache):', e1.message)

  const { error: e2 } = await admin.from('comment_reads').delete().in('episode_id', ids)
  if (e2 && !isSchemaCacheError(e2)) { console.error('[delete] comment_reads:', e2.message); return NextResponse.json({ error: e2.message }, { status: 500 }) }
  if (e2) console.warn('[delete] comment_reads skipped (schema cache):', e2.message)

  if (taskIds.length > 0) {
    const { error: e3 } = await admin.from('comments').delete().in('task_id', taskIds)
    if (e3) { console.error('[delete] comments by task:', e3.message); return NextResponse.json({ error: e3.message }, { status: 500 }) }
  }

  const { error: e4 } = await admin.from('comments').delete().in('episode_id', ids)
  if (e4) { console.error('[delete] comments by episode:', e4.message); return NextResponse.json({ error: e4.message }, { status: 500 }) }

  const { error: e5 } = await admin.from('task_history').delete().in('episode_id', ids)
  if (e5 && !isSchemaCacheError(e5)) { console.error('[delete] task_history:', e5.message); return NextResponse.json({ error: e5.message }, { status: 500 }) }
  if (e5) console.warn('[delete] task_history skipped (schema cache):', e5.message)

  const { error: e6 } = await admin.from('episode_images').delete().in('episode_id', ids)
  if (e6 && !isSchemaCacheError(e6)) { console.error('[delete] episode_images:', e6.message); return NextResponse.json({ error: e6.message }, { status: 500 }) }
  if (e6) console.warn('[delete] episode_images skipped (schema cache):', e6.message)

  const { error: e7 } = await admin.from('notifications').delete().in('episode_id', ids)
  if (e7 && !isSchemaCacheError(e7)) { console.error('[delete] notifications:', e7.message); return NextResponse.json({ error: e7.message }, { status: 500 }) }
  if (e7) console.warn('[delete] notifications skipped (schema cache):', e7.message)

  const { error: e8 } = await admin.from('activity_log').delete().in('episode_id', ids)
  if (e8 && !isSchemaCacheError(e8)) { console.error('[delete] activity_log:', e8.message); return NextResponse.json({ error: e8.message }, { status: 500 }) }
  if (e8) console.warn('[delete] activity_log skipped (schema cache):', e8.message)

  const { error: e9 } = await admin.from('tasks').delete().in('episode_id', ids)
  if (e9) { console.error('[delete] tasks:', e9.message); return NextResponse.json({ error: e9.message }, { status: 500 }) }

  const { error: e10 } = await admin.from('episodes').delete().in('id', ids)
  if (e10) { console.error('[delete] episodes:', e10.message); return NextResponse.json({ error: e10.message }, { status: 500 }) }

  console.log(`[delete] Successfully deleted episodes [${ids.join(', ')}] and all related records`)
  return NextResponse.json({ success: true })
}

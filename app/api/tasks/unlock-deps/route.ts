import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const { episodeId } = await req.json()
  if (!episodeId) return NextResponse.json({ unlocked: 0 })

  const supabase = createAdminClient()

  const { data: allTasks } = await supabase.from('tasks').select('*').eq('episode_id', episodeId)
  if (!allTasks) return NextResponse.json({ unlocked: 0 })

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
      fetch(`${process.env.NEXT_PUBLIC_SITE_URL || ''}/api/push/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: assignee.id,
          title: 'New task started',
          body: `"${t.label}" is now in progress`,
          url: `/episodes/${episodeId}`,
          tag: 'task_unlocked',
        }),
      }).catch(() => {})
    }
  }

  return NextResponse.json({ unlocked })
}

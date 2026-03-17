import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EpisodeDetailClient } from './EpisodeDetailClient'
import type { User, Episode, Task } from '@/lib/types'

export default async function EpisodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileRes, episodeRes, tasksRes] = await Promise.all([
    supabase.from('users').select('*').eq('id', user.id).single(),
    supabase.from('episodes').select('*').eq('id', id).single(),
    supabase
      .from('tasks')
      .select('*, assignee:users(*)')
      .eq('episode_id', id)
      .order('template_task_id', { ascending: true }),
  ])

  if (!episodeRes.data) notFound()

  const taskIds = (tasksRes.data || []).map(t => t.id)

  const { data: commentsData } = taskIds.length > 0
    ? await supabase
        .from('comments')
        .select('task_id, body, created_at')
        .in('task_id', taskIds)
        .order('created_at', { ascending: false })
    : { data: [] }

  // Latest comment + count per task
  const taskComments: Record<string, { count: number; latest: string }> = {}
  for (const c of (commentsData || [])) {
    if (!taskComments[c.task_id]) {
      taskComments[c.task_id] = { count: 0, latest: c.body }
    }
    taskComments[c.task_id].count++
  }

  return (
    <EpisodeDetailClient
      currentUser={profileRes.data as User}
      episode={episodeRes.data as Episode}
      initialTasks={(tasksRes.data || []) as unknown as Task[]}
      taskComments={taskComments}
    />
  )
}

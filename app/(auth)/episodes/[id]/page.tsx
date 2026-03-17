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

  return (
    <EpisodeDetailClient
      currentUser={profileRes.data as User}
      episode={episodeRes.data as Episode}
      initialTasks={(tasksRes.data || []) as unknown as Task[]}
    />
  )
}

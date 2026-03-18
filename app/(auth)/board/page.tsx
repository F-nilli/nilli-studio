import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BoardClient } from './BoardClient'
import type { User, Episode, Task } from '@/lib/types'

export default async function BoardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const isAdmin = profile.role === 'admin'

  const usersRes = await supabase.from('users').select('*')

  if (isAdmin) {
    const [episodesRes, tasksRes] = await Promise.all([
      supabase.from('episodes').select('*').is('published_at', null).order('release_date', { ascending: true }),
      supabase.from('tasks').select('*, assignee:users(*)').order('template_task_id', { ascending: true }),
    ])
    return (
      <BoardClient
        currentUser={profile as User}
        episodes={(episodesRes.data || []) as Episode[]}
        tasks={(tasksRes.data || []) as unknown as Task[]}
        allUsers={(usersRes.data || []) as User[]}
      />
    )
  }

  // Non-admin: find episodes they're involved in, show full task picture per card
  const { data: myTasks } = await supabase
    .from('tasks')
    .select('episode_id')
    .eq('assignee_id', user.id)

  const involvedEpisodeIds = [...new Set((myTasks || []).map(t => t.episode_id))]

  if (involvedEpisodeIds.length === 0) {
    return (
      <BoardClient
        currentUser={profile as User}
        episodes={[]}
        tasks={[]}
        allUsers={(usersRes.data || []) as User[]}
      />
    )
  }

  const [episodesRes, tasksRes] = await Promise.all([
    supabase.from('episodes').select('*').in('id', involvedEpisodeIds).is('published_at', null).order('release_date', { ascending: true }),
    supabase.from('tasks').select('*, assignee:users(*)').in('episode_id', involvedEpisodeIds).order('template_task_id', { ascending: true }),
  ])

  return (
    <BoardClient
      currentUser={profile as User}
      episodes={(episodesRes.data || []) as Episode[]}
      tasks={(tasksRes.data || []) as unknown as Task[]}
      allUsers={(usersRes.data || []) as User[]}
    />
  )
}

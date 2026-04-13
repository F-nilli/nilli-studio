import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CalendarClient } from './CalendarClient'
import type { User, Task, Episode } from '@/lib/types'

export default async function CalendarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profileRes = await supabase.from('users').select('*').eq('id', user.id).single()
  const currentUser = profileRes.data as User
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'ops_manager'

  if (isAdmin) {
    // Admin: fetch tasks and episodes in parallel
    const [tasksRes, episodesRes] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, assignee:users!assignee_id(*), episode:episodes(*)')
        .not('due_date', 'is', null)
        .order('due_date', { ascending: true }),
      supabase
        .from('episodes')
        .select('id, guest_name, client_label, release_date')
        .is('published_at', null)
        .order('release_date', { ascending: true }),
    ])

    return (
      <CalendarClient
        currentUser={currentUser}
        tasks={(tasksRes.data ?? []) as unknown as (Task & { episode: Episode })[]}
        episodes={(episodesRes.data ?? []) as Pick<Episode, 'id' | 'guest_name' | 'client_label' | 'release_date'>[]}
        allUsers={[]}
      />
    )
  }

  // Member: need task list first to derive episode IDs
  const { data: tasksData } = await supabase
    .from('tasks')
    .select('*, assignee:users!assignee_id(*), episode:episodes(*)')
    .not('due_date', 'is', null)
    .eq('assignee_id', user.id)
    .order('due_date', { ascending: true })

  const myTasks = (tasksData ?? []) as unknown as (Task & { episode: Episode })[]
  const episodeIds = [...new Set(myTasks.map(t => t.episode_id).filter(Boolean))]

  const episodes: Pick<Episode, 'id' | 'guest_name' | 'client_label' | 'release_date'>[] =
    episodeIds.length > 0
      ? ((await supabase
          .from('episodes')
          .select('id, guest_name, client_label, release_date')
          .in('id', episodeIds)
          .is('published_at', null)
          .order('release_date', { ascending: true })).data ?? []) as Pick<Episode, 'id' | 'guest_name' | 'client_label' | 'release_date'>[]
      : []

  return (
    <CalendarClient
      currentUser={currentUser}
      tasks={myTasks}
      episodes={episodes}
      allUsers={[]}
    />
  )
}

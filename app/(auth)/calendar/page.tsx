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

  const taskQuery = supabase
    .from('tasks')
    .select('*, assignee:users!assignee_id(*), episode:episodes(*)')
    .not('due_date', 'is', null)
    .order('due_date', { ascending: true })

  const tasksRes = isAdmin
    ? await taskQuery
    : await taskQuery.eq('assignee_id', user.id)

  const myTasks = (tasksRes.data ?? []) as unknown as (Task & { episode: Episode })[]

  // For members: only load release dates for episodes they're assigned to
  // For admins: load all unpublished episodes
  let episodesRes: { data: Pick<Episode, 'id' | 'guest_name' | 'client_label' | 'release_date'>[] }
  if (isAdmin) {
    const { data } = await supabase
      .from('episodes')
      .select('id, guest_name, client_label, release_date')
      .is('published_at', null)
      .order('release_date', { ascending: true })
    episodesRes = { data: (data ?? []) as Pick<Episode, 'id' | 'guest_name' | 'client_label' | 'release_date'>[] }
  } else {
    const episodeIds = [...new Set(myTasks.map(t => t.episode_id).filter(Boolean))]
    if (episodeIds.length > 0) {
      const { data } = await supabase
        .from('episodes')
        .select('id, guest_name, client_label, release_date')
        .in('id', episodeIds)
        .is('published_at', null)
        .order('release_date', { ascending: true })
      episodesRes = { data: (data ?? []) as Pick<Episode, 'id' | 'guest_name' | 'client_label' | 'release_date'>[] }
    } else {
      episodesRes = { data: [] }
    }
  }

  return (
    <CalendarClient
      currentUser={currentUser}
      tasks={myTasks}
      episodes={episodesRes.data}
      allUsers={[]}
    />
  )
}

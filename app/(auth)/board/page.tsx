import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BoardClient } from './BoardClient'
import type { User, Episode, Task } from '@/lib/types'
import { canSeeAllEpisodes } from '@/lib/types'

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const params = await searchParams
  const memberFilterId = params.member || null

  const usersRes = await supabase.from('users').select('*')

  // Always fetch published episodes for the Archive tab
  const { data: publishedEpisodesData } = await supabase
    .from('episodes')
    .select('*')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })

  if (canSeeAllEpisodes(profile)) {
    const [episodesRes, tasksRes] = await Promise.all([
      supabase.from('episodes').select('*, source:episodes!source_episode_id(id, guest_name, template_name)').is('published_at', null).order('release_date', { ascending: true }),
      supabase.from('tasks').select('*, assignee:users!assignee_id(*), approver:users!approver_id(*)').order('template_task_id', { ascending: true }),
    ])
    return (
      <BoardClient
        currentUser={profile as User}
        episodes={(episodesRes.data || []) as Episode[]}
        tasks={(tasksRes.data || []) as unknown as Task[]}
        allUsers={(usersRes.data || []) as User[]}
        publishedEpisodes={(publishedEpisodesData || []) as Episode[]}
        memberFilterId={memberFilterId}
      />
    )
  }

  // Member: find episodes they're involved in
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
        publishedEpisodes={(publishedEpisodesData || []) as Episode[]}
        memberFilterId={memberFilterId}
      />
    )
  }

  const [episodesRes, tasksRes] = await Promise.all([
    supabase.from('episodes').select('*, source:episodes!source_episode_id(id, guest_name, template_name)').in('id', involvedEpisodeIds).is('published_at', null).order('release_date', { ascending: true }),
    supabase.from('tasks').select('*, assignee:users(*)').in('episode_id', involvedEpisodeIds).order('template_task_id', { ascending: true }),
  ])

  return (
    <BoardClient
      currentUser={profile as User}
      episodes={(episodesRes.data || []) as Episode[]}
      tasks={(tasksRes.data || []) as unknown as Task[]}
      allUsers={(usersRes.data || []) as User[]}
      publishedEpisodes={(publishedEpisodesData || []) as Episode[]}
      memberFilterId={memberFilterId}
    />
  )
}

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BoardClient } from './BoardClient'
import type { User, Episode, Task } from '@/lib/types'

export default async function BoardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  const [episodesRes, tasksRes, usersRes] = await Promise.all([
    supabase
      .from('episodes')
      .select('*')
      .order('release_date', { ascending: true }),
    supabase
      .from('tasks')
      .select('*, assignee:users(*)')
      .order('template_task_id', { ascending: true }),
    supabase.from('users').select('*'),
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

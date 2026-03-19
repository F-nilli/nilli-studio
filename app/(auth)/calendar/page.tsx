import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CalendarClient } from './CalendarClient'
import type { User, Task, Episode } from '@/lib/types'

export default async function CalendarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileRes, tasksRes] = await Promise.all([
    supabase.from('users').select('*').eq('id', user.id).single(),
    supabase
      .from('tasks')
      .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
      .eq('assignee_id', user.id)
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true }),
  ])

  return (
    <CalendarClient
      currentUser={profileRes.data as User}
      tasks={(tasksRes.data || []) as unknown as (Task & { episode: Episode })[]}
    />
  )
}

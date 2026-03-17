import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from './DashboardClient'
import type { User, Task, Episode } from '@/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileRes, tasksRes] = await Promise.all([
    supabase.from('users').select('*').eq('id', user.id).single(),
    supabase
      .from('tasks')
      .select('*, assignee:users(*), episode:episodes(*)')
      .eq('assignee_id', user.id)
      .neq('status', 'done')
      .order('due_date', { ascending: true, nullsFirst: false }),
  ])

  return (
    <DashboardClient
      currentUser={profileRes.data as User}
      tasks={(tasksRes.data || []) as unknown as (Task & { episode: Episode })[]}
    />
  )
}

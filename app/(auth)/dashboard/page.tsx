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
      .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
      .eq('assignee_id', user.id)
      .neq('status', 'done')
      .order('due_date', { ascending: true, nullsFirst: false }),
  ])

  const profile = profileRes.data as User
  let reviewTasks: (Task & { episode: Episode })[] = []

  // Show in_review tasks where current user is the designated approver (or admin sees all)
  const isAdmin = profile.role === 'admin'
  const reviewQuery = supabase
    .from('tasks')
    .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
    .eq('status', 'in_review')
    .eq('requires_approval', true)
    .neq('assignee_id', user.id)
    .order('due_date', { ascending: true, nullsFirst: false })

  if (!isAdmin) {
    reviewQuery.eq('approver_id', user.id)
  }

  const { data: reviewData } = await reviewQuery
  reviewTasks = (reviewData || []) as unknown as (Task & { episode: Episode })[]

  return (
    <DashboardClient
      currentUser={profile}
      tasks={(tasksRes.data || []) as unknown as (Task & { episode: Episode })[]}
      reviewTasks={reviewTasks}
    />
  )
}

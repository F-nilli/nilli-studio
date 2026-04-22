import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from './DashboardClient'
import type { User, Task, Episode } from '@/lib/types'

export interface EpisodeProgress {
  id: string
  guest_name: string
  client_label: string
  release_date: string
  totalTasks: number
  doneTasks: number
  overdueTasks: number
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase.from('users').select('*').eq('id', user.id).single()
  const currentUser = profileData as User

  const isAdminOrManager = currentUser.role === 'admin' || currentUser.role === 'ops_manager'

  // Run all independent queries in parallel
  const [myTasksData, reviewData, epData] = await Promise.all([
    // My tasks (all roles)
    supabase
      .from('tasks')
      .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
      .eq('assignee_id', user.id)
      .neq('status', 'done')
      .neq('status', 'approved')
      .order('due_date', { ascending: true, nullsFirst: false }),

    // Review tasks (ops_manager + admin)
    currentUser.role === 'admin'
      ? supabase
          .from('tasks')
          .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
          .eq('status', 'in_review')
          .eq('requires_approval', true)
          .neq('assignee_id', user.id)
          .order('due_date', { ascending: true, nullsFirst: false })
      : supabase
          .from('tasks')
          .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
          .eq('status', 'in_review')
          .eq('requires_approval', true)
          .neq('assignee_id', user.id)
          .eq('approver_id', user.id)
          .order('due_date', { ascending: true, nullsFirst: false }),

    // Episodes progress (admin + ops_manager only)
    isAdminOrManager
      ? supabase
          .from('episodes')
          .select('id, guest_name, client_label, release_date, tasks(id, status, due_date, requires_approval, review_started_at)')
          .eq('archived', false)
          .order('release_date', { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: null, error: null }),
  ])

  const myTasks = ((myTasksData.data || []) as unknown as (Task & { episode: Episode })[])
    .filter(t => !t.episode?.archived)
  const reviewTasks = ((reviewData.data || []) as unknown as (Task & { episode: Episode })[])
    .filter(t => !t.episode?.archived)

  type EpTask = { id: string; status: string; due_date: string | null; requires_approval: boolean; review_started_at: string | null }
  type EpRow = { id: string; guest_name: string; client_label: string; release_date: string; tasks: EpTask[] }

  const now = new Date()
  const todayMidnight = new Date(now)
  todayMidnight.setHours(0, 0, 0, 0)

  const episodesProgress: EpisodeProgress[] = isAdminOrManager
    ? ((epData.data || []) as unknown as EpRow[])
        .map(ep => {
          const tasks = ep.tasks || []
          const total = tasks.length
          const done = tasks.filter(t => t.status === 'done' || t.status === 'approved').length
          const overdue = tasks.filter(t => {
            if (['done', 'approved', 'locked'].includes(t.status)) return false
            if (t.due_date && new Date(t.due_date) < todayMidnight) return true
            if (t.status === 'in_review' && t.requires_approval && t.review_started_at) {
              return Date.now() - new Date(t.review_started_at).getTime() >= 12 * 60 * 60 * 1000
            }
            return false
          }).length
          return { id: ep.id, guest_name: ep.guest_name, client_label: ep.client_label, release_date: ep.release_date, totalTasks: total, doneTasks: done, overdueTasks: overdue }
        })
        .filter(ep => ep.totalTasks > 0 && ep.doneTasks < ep.totalTasks)
    : []

  let atRiskTasks: (Task & { episode: Episode })[] = []
  let upcomingReleases: Episode[] = []
  let teamTasks: (Task & { episode: Episode })[] = []
  let allUsers: User[] = []

  if (currentUser.role === 'admin') {
    const todayStr = now.toISOString().split('T')[0]
    const twoWeeksStr = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()

    const [atRiskByDateRes, atRiskInReviewRes, upcomingRes, teamTasksRes, allUsersRes] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
        .in('status', ['in_progress', 'revision'])
        .lt('due_date', todayStr)
        .order('due_date', { ascending: true }),
      supabase
        .from('tasks')
        .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
        .eq('status', 'in_review')
        .eq('requires_approval', true)
        .lt('review_started_at', twelveHoursAgo)
        .order('review_started_at', { ascending: true }),
      supabase
        .from('episodes')
        .select('*')
        .gte('release_date', todayStr)
        .lte('release_date', twoWeeksStr)
        .order('release_date', { ascending: true }),
      // All active team tasks for workload view
      supabase
        .from('tasks')
        .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
        .in('status', ['in_progress', 'in_review', 'revision'])
        .order('due_date', { ascending: true, nullsFirst: false }),
      // All users for workload headers
      supabase.from('users').select('*').neq('active', false).order('name'),
    ])

    const seen = new Set<string>()
    atRiskTasks = [
      ...((atRiskByDateRes.data || []) as unknown as (Task & { episode: Episode })[]),
      ...((atRiskInReviewRes.data || []) as unknown as (Task & { episode: Episode })[]),
    ].filter(t => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return !t.episode?.archived
    })

    upcomingReleases = (upcomingRes.data || []) as Episode[]
    teamTasks = ((teamTasksRes.data || []) as unknown as (Task & { episode: Episode })[])
      .filter(t => !t.episode?.archived)
    allUsers = ((allUsersRes.data || []) as unknown as User[])
  }

  return (
    <DashboardClient
      currentUser={currentUser}
      tasks={myTasks}
      reviewTasks={reviewTasks}
      episodesProgress={episodesProgress}
      atRiskTasks={atRiskTasks}
      upcomingReleases={upcomingReleases}
      teamTasks={teamTasks}
      allUsers={allUsers}
    />
  )
}

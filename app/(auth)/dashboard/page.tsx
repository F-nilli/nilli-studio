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

  // My tasks (all roles)
  const { data: myTasksData } = await supabase
    .from('tasks')
    .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
    .eq('assignee_id', user.id)
    .neq('status', 'done')
    .neq('status', 'approved')
    .order('due_date', { ascending: true, nullsFirst: false })

  const myTasks = (myTasksData || []) as unknown as (Task & { episode: Episode })[]

  // Review tasks (in_review, requires_approval, not own task)
  const reviewQuery = supabase
    .from('tasks')
    .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
    .eq('status', 'in_review')
    .eq('requires_approval', true)
    .neq('assignee_id', user.id)
    .order('due_date', { ascending: true, nullsFirst: false })

  if (currentUser.role !== 'admin') {
    reviewQuery.eq('approver_id', user.id)
  }
  const { data: reviewData, error: reviewError } = await reviewQuery
  if (reviewError) console.error('[Review query] error:', reviewError.message, reviewError.code)
  console.log(`[Review query] user=${user.id} role=${currentUser.role} results=${reviewData?.length ?? 0}`)
  if (reviewData?.length === 0 && currentUser.role !== 'admin') {
    // Debug: show what's in_review to compare approver_id values
    const { data: debugTasks } = await supabase.from('tasks').select('id, label, status, approver_id').eq('status', 'in_review').limit(10)
    if (debugTasks?.length) {
      console.log('[Review query] in_review tasks:', debugTasks.map(t => ({ id: t.id, label: t.label, approver_id: t.approver_id, matches: t.approver_id === user.id })))
    }
  }
  const reviewTasks = (reviewData || []) as unknown as (Task & { episode: Episode })[]

  let episodesProgress: EpisodeProgress[] = []
  let atRiskTasks: (Task & { episode: Episode })[] = []
  let upcomingReleases: Episode[] = []

  if (currentUser.role === 'ops_manager' || currentUser.role === 'admin') {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const todayMidnight = new Date(now)
    todayMidnight.setHours(0, 0, 0, 0)

    // Episodes with task counts for mini production overview
    const { data: epData } = await supabase
      .from('episodes')
      .select('id, guest_name, client_label, release_date, tasks(id, status, due_date, requires_approval, review_started_at)')
      .order('release_date', { ascending: true, nullsFirst: false })

    type EpTask = { id: string; status: string; due_date: string | null; requires_approval: boolean; review_started_at: string | null }
    type EpRow = { id: string; guest_name: string; client_label: string; release_date: string; tasks: EpTask[] }

    episodesProgress = ((epData || []) as unknown as EpRow[])
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
        return {
          id: ep.id,
          guest_name: ep.guest_name,
          client_label: ep.client_label,
          release_date: ep.release_date,
          totalTasks: total,
          doneTasks: done,
          overdueTasks: overdue,
        }
      })
      .filter(ep => ep.totalTasks > 0 && ep.doneTasks < ep.totalTasks)

    if (currentUser.role === 'admin') {
      const twoWeeksStr = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()

      const [atRiskByDateRes, atRiskInReviewRes, upcomingRes] = await Promise.all([
        // Tasks past their due date (not done/approved/locked)
        supabase
          .from('tasks')
          .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
          .in('status', ['ready', 'in_progress', 'revision'])
          .lt('due_date', todayStr)
          .order('due_date', { ascending: true }),
        // Tasks in_review for 12+ hours
        supabase
          .from('tasks')
          .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
          .eq('status', 'in_review')
          .eq('requires_approval', true)
          .lt('review_started_at', twelveHoursAgo)
          .order('review_started_at', { ascending: true }),
        // Episodes releasing in next 14 days
        supabase
          .from('episodes')
          .select('*')
          .gte('release_date', todayStr)
          .lte('release_date', twoWeeksStr)
          .order('release_date', { ascending: true }),
      ])

      const seen = new Set<string>()
      atRiskTasks = [
        ...((atRiskByDateRes.data || []) as unknown as (Task & { episode: Episode })[]),
        ...((atRiskInReviewRes.data || []) as unknown as (Task & { episode: Episode })[]),
      ].filter(t => {
        if (seen.has(t.id)) return false
        seen.add(t.id)
        return true
      })

      upcomingReleases = (upcomingRes.data || []) as Episode[]
    }
  }

  return (
    <DashboardClient
      currentUser={currentUser}
      tasks={myTasks}
      reviewTasks={reviewTasks}
      episodesProgress={episodesProgress}
      atRiskTasks={atRiskTasks}
      upcomingReleases={upcomingReleases}
    />
  )
}

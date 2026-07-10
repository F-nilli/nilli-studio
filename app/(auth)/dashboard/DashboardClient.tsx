'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Clock, Lock, CheckCircle, AlertTriangle, Calendar, Users, MessageSquare, SendHorizonal, Pencil, Trash2, ArrowRight } from 'lucide-react'
import { usePendingActions } from '@/lib/usePendingActions'
import { WorkloadMetricsCard } from '@/components/dashboard/WorkloadMetricsCard'
import { UndoToastStack } from '@/components/ui/UndoToastStack'
import { differenceInDays, differenceInHours, format, parseISO, startOfToday } from 'date-fns'
import { Task, Episode, User, TaskStatus, UserQuota } from '@/lib/types'
import { StatusBadge, VersionBadge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { cn, formatDate, isOverdue, STATUS_LABELS, parseDate } from '@/lib/utils'
import { markTaskNotificationsRead } from '@/lib/notifications'
import { TRACK_COLORS } from '@/lib/constants'
import { TaskModal } from '@/components/tasks/TaskModal'
import { renderBriefBody } from '@/components/tasks/TaskBriefEditor'
import { ReassignDropdown } from '@/components/tasks/ReassignDropdown'
import { InfoIcon } from '@/components/ui/InfoIcon'
import { createClient } from '@/lib/supabase/client'
import type { EpisodeProgress } from './page'

const ACTIVE_STATUSES: TaskStatus[] = ['in_progress', 'in_review', 'revision']

type MonthlyOutputMap = Record<string, Record<string, number>> // userId → track → quantity sum

interface Props {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  reviewTasks: (Task & { episode: Episode })[]
  episodesProgress: EpisodeProgress[]
  atRiskTasks: (Task & { episode: Episode })[]
  upcomingReleases: Episode[]
  teamTasks: (Task & { episode: Episode })[]
  allUsers: User[]
  userQuotas: UserQuota[]
  monthlyOutput: MonthlyOutputMap
}

export function DashboardClient({
  currentUser,
  tasks: initialTasks,
  reviewTasks: initialReviewTasks,
  episodesProgress,
  atRiskTasks,
  upcomingReleases,
  teamTasks,
  allUsers,
  userQuotas,
  monthlyOutput,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const [tasks, setTasks] = useState(initialTasks)
  const [reviewTasks, setReviewTasks] = useState(initialReviewTasks)
  const [selectedTask, setSelectedTask] = useState<(Task & { episode?: Episode }) | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const { pendingActions, addPending, undoPending, silentPending } = usePendingActions()
  const lastRefreshRef = useRef<number>(Date.now())
  const lastCountsRef = useRef<{ myTasksCount: number; reviewCount: number } | null>(null)

  // Refresh on tab focus + smart poll every 3 minutes as Realtime fallback
  useEffect(() => {
    const POLL_INTERVAL = 3 * 60 * 1000 // 3 minutes
    const MIN_REFRESH_GAP = 30 * 1000   // don't full-refresh more than once per 30s

    function fullRefresh() {
      const now = Date.now()
      if (now - lastRefreshRef.current < MIN_REFRESH_GAP) return
      lastRefreshRef.current = now
      router.refresh()
    }

    // Lightweight poll: only triggers full refresh if counts changed
    async function smartPoll() {
      try {
        const res = await fetch('/api/dashboard-counts')
        if (!res.ok) return
        const counts = await res.json() as { myTasksCount: number; reviewCount: number }
        const prev = lastCountsRef.current
        lastCountsRef.current = counts
        if (!prev) return // first poll — just store baseline
        if (counts.myTasksCount !== prev.myTasksCount || counts.reviewCount !== prev.reviewCount) {
          fullRefresh()
        }
      } catch {
        // ignore network errors silently
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') fullRefresh()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    const interval = setInterval(smartPoll, POLL_INTERVAL)
    // Seed the baseline immediately
    smartPoll()

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearInterval(interval)
    }
  }, [router])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Sync state when server-side props refresh (router.refresh())
  useEffect(() => { setTasks(initialTasks) }, [initialTasks])
  useEffect(() => { setReviewTasks(initialReviewTasks) }, [initialReviewTasks])

  // Realtime: my tasks
  useEffect(() => {
    const channel = supabase
      .channel(`dash-my-tasks-${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${currentUser.id}` },
        async (payload) => {
          const updated = payload.new as Task
          // Drop the task from "my tasks" once it leaves my hands:
          // - done/approved → finished, nothing to do
          // - in_review with someone else as approver → waiting on them, not me
          const handedOff =
            updated.status === 'in_review' &&
            updated.approver_id !== null &&
            updated.approver_id !== currentUser.id
          if (updated.status === 'done' || updated.status === 'approved' || handedOff) {
            setTasks(prev => prev.filter(t => t.id !== updated.id))
          } else {
            const { data } = await supabase
              .from('tasks')
              .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
              .eq('id', updated.id)
              .single()
            // Drop tasks whose episode is archived — they don't belong on the dashboard.
            if (data && !(data as { episode?: { archived?: boolean } }).episode?.archived) {
              setTasks(prev => {
                const exists = prev.find(t => t.id === data.id)
                if (exists) return prev.map(t => t.id === data.id ? data as unknown as Task & { episode: Episode } : t)
                return [...prev, data as unknown as Task & { episode: Episode }]
              })
            } else if (data) {
              // Episode was archived between fetches — make sure it's not in state.
              setTasks(prev => prev.filter(t => t.id !== data.id))
            }
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser.id])

  // Realtime: episode archives — when a project archives, drop all its tasks
  // from the dashboard's local state immediately (no refresh required).
  useEffect(() => {
    const channel = supabase
      .channel(`dash-episodes-${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'episodes' },
        (payload) => {
          const before = payload.old as { archived?: boolean } | null
          const after = payload.new as { id: string; archived?: boolean } | null
          if (!after?.id) return
          // Only react when archived flipped to true
          if (after.archived && !before?.archived) {
            setTasks(prev => prev.filter(t => t.episode_id !== after.id))
            setReviewTasks(prev => prev.filter(t => t.episode_id !== after.id))
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser.id])

  // Realtime: review tasks (ops_manager + admin)
  useEffect(() => {
    if (currentUser.role === 'member') return
    const channel = supabase
      .channel(`dash-review-${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks' },
        async (payload) => {
          const updated = payload.new as Task
          if (updated.status !== 'in_review') {
            setReviewTasks(prev => prev.filter(t => t.id !== updated.id))
          } else {
            const shouldShow =
              updated.requires_approval &&
              updated.assignee_id !== currentUser.id &&
              (currentUser.role === 'admin' || updated.approver_id === currentUser.id)
            if (shouldShow) {
              const { data } = await supabase
                .from('tasks')
                .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
                .eq('id', updated.id)
                .single()
              // Drop tasks whose episode is archived — they don't belong on the dashboard.
              if (data && !(data as { episode?: { archived?: boolean } }).episode?.archived) {
                setReviewTasks(prev => {
                  const exists = prev.find(t => t.id === data.id)
                  if (exists) return prev.map(t => t.id === data.id ? data as unknown as Task & { episode: Episode } : t)
                  return [...prev, data as unknown as Task & { episode: Episode }]
                })
              } else if (data) {
                setReviewTasks(prev => prev.filter(t => t.id !== data.id))
              }
            }
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser.id, currentUser.role])

  function handleTaskUpdate(updated: Task) {
    // Same hand-off logic as the realtime subscription — drop the task from
    // "my tasks" the instant it leaves my hands (submitted for review where
    // someone else is the approver, or finished).
    const handedOff =
      updated.status === 'in_review' &&
      updated.approver_id !== null &&
      updated.approver_id !== currentUser.id
    if (updated.status === 'done' || updated.status === 'approved' || handedOff) {
      setTasks(prev => prev.filter(t => t.id !== updated.id))
    } else {
      setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t))
    }
    if (updated.status !== 'in_review') {
      setReviewTasks(prev => prev.filter(t => t.id !== updated.id))
    }
    if (selectedTask?.id === updated.id) setSelectedTask(prev => prev ? { ...prev, ...updated } : null)
  }

  return (
    <>
      {currentUser.role === 'member' && (
        <MemberDashboard
          currentUser={currentUser}
          tasks={tasks}
          userQuotas={userQuotas}
          monthlyOutput={monthlyOutput}
          onTaskClick={setSelectedTask}
          onTaskUpdate={handleTaskUpdate}
          onReassignToast={setToast}
          onPendingAction={addPending}
        />
      )}

      {currentUser.role === 'ops_manager' && (
        <OpsManagerDashboard
          currentUser={currentUser}
          tasks={tasks}
          reviewTasks={reviewTasks}
          episodesProgress={episodesProgress}
          userQuotas={userQuotas}
          monthlyOutput={monthlyOutput}
          onTaskClick={setSelectedTask}
          onTaskUpdate={handleTaskUpdate}
          onReassignToast={setToast}
          onPendingAction={addPending}
        />
      )}

      {currentUser.role === 'admin' && (
        <AdminDashboard
          currentUser={currentUser}
          tasks={tasks}
          reviewTasks={reviewTasks}
          episodesProgress={episodesProgress}
          atRiskTasks={atRiskTasks}
          upcomingReleases={upcomingReleases}
          teamTasks={teamTasks}
          allUsers={allUsers}
          userQuotas={userQuotas}
          monthlyOutput={monthlyOutput}
          onTaskClick={setSelectedTask}
          onTaskUpdate={handleTaskUpdate}
          onReassignToast={setToast}
          onPendingAction={addPending}
        />
      )}

      {selectedTask && (
        <TaskModal
          task={selectedTask as Task}
          currentUser={currentUser}
          episode={selectedTask.episode ?? undefined}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => { handleTaskUpdate(updated); setSelectedTask(prev => prev ? { ...prev, ...updated } : null) }}
          onPendingAction={(label, revert, commit) => { setSelectedTask(null); addPending(label, revert, commit) }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-sm font-medium text-white shadow-xl"
          style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.15)' }}>
          {toast}
        </div>
      )}
      <UndoToastStack actions={pendingActions} onUndo={undoPending} onSilent={silentPending} />
    </>
  )
}

// ─── Member Dashboard ───────────────────────────────────────────────────────

function MemberDashboard({ currentUser, tasks, userQuotas, monthlyOutput, onTaskClick, onTaskUpdate, onReassignToast, onPendingAction }: {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  userQuotas: UserQuota[]
  monthlyOutput: MonthlyOutputMap
  onTaskClick: (task: Task & { episode?: Episode }) => void
  onTaskUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
  onPendingAction: (label: string, revert: () => void, commit: (silent: boolean) => Promise<void>) => void
}) {
  const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status as TaskStatus))
  const lockedTasks = tasks.filter(t => t.status === 'locked')
  const myQuotas = userQuotas.filter(q => q.user_id === currentUser.id)
  const overdueCount = activeTasks.filter(t => isOverdue(t.due_date, t.status, t.requires_approval, t.review_started_at)).length
  const grouped = ACTIVE_STATUSES.reduce<Record<TaskStatus, (Task & { episode: Episode })[]>>(
    (acc, s) => { acc[s] = activeTasks.filter(t => t.status === s); return acc },
    {} as Record<TaskStatus, (Task & { episode: Episode })[]>
  )

  const isEmpty = activeTasks.length === 0 && lockedTasks.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold text-white">Hey, {currentUser.name.split(' ')[0]}</h1>
        <p className="text-[#888] text-[15px] mt-1">
          {activeTasks.length > 0
            ? `${activeTasks.length} active task${activeTasks.length !== 1 ? 's' : ''}`
            : 'No active tasks'}
          {lockedTasks.length > 0 && <span className="ml-2 text-[#555]">· {lockedTasks.length} upcoming</span>}
          {overdueCount > 0 && <span className="ml-2 text-[#ff3c00] font-medium">· {overdueCount} overdue</span>}
        </p>
      </div>

      {/* Personal output quota card */}
      {myQuotas.length > 0 && (
        <OutputQuotaCard
          quotas={myQuotas}
          output={monthlyOutput[currentUser.id] ?? {}}
        />
      )}

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-5 border border-[#2a2a2a]">
            <CheckCircle className="w-8 h-8 text-[#2e2e2e]" />
          </div>
          <p className="text-white font-bold text-lg">You&apos;re all caught up</p>
          <p className="text-[#555] text-sm mt-1.5">No active or queued tasks right now</p>
        </div>
      ) : (
        <>
          {overdueCount > 0 && (
            <div className="bg-[#dc2626] rounded-xl p-5 flex items-center gap-5">
              <div className="flex items-center justify-center w-14 h-14 bg-white/20 rounded-xl shrink-0">
                <span className="text-3xl font-black text-white leading-none">{overdueCount}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-black text-lg leading-tight">
                  {overdueCount} overdue task{overdueCount !== 1 ? 's' : ''}
                </p>
                <p className="text-white/80 text-sm font-medium mt-0.5">
                  {overdueCount !== 1 ? 'These tasks need' : 'This task needs'} your immediate attention
                </p>
              </div>
              <button
                onClick={() => document.getElementById('overdue-section')?.scrollIntoView({ behavior: 'smooth' })}
                className="shrink-0 px-4 py-2.5 bg-white text-[#dc2626] font-bold text-sm rounded-lg hover:bg-white/90 transition-colors"
              >
                View overdue
              </button>
            </div>
          )}

          <div className="dashboard-scroll-column space-y-8 overflow-y-auto pr-2" style={{ maxHeight: '620px' }}>
            {ACTIVE_STATUSES.map(status => {
              const statusTasks = grouped[status]
              if (!statusTasks || statusTasks.length === 0) return null
              const hasOverdue = statusTasks.some(t => isOverdue(t.due_date, t.status, t.requires_approval, t.review_started_at))
              return (
                <div key={status} id={hasOverdue ? 'overdue-section' : undefined}>
                  <div className="sticky top-0 z-[5] -mx-1 px-1 py-1 backdrop-blur-sm" style={{ background: 'rgba(13,13,13,0.85)' }}>
                    <SectionLabel label={STATUS_LABELS[status]} count={statusTasks.length} />
                  </div>
                  <div className="space-y-2 mt-3">
                    {statusTasks.map(task => (
                      <TaskCard key={task.id} task={task} currentUser={currentUser} onClick={() => onTaskClick(task)} onUpdate={onTaskUpdate} onReassignToast={onReassignToast} onPendingAction={onPendingAction} />
                    ))}
                  </div>
                </div>
              )
            })}

            {lockedTasks.length > 0 && (
              <div>
                <div className="sticky top-0 z-[5] -mx-1 px-1 py-1 backdrop-blur-sm flex items-center gap-2 mb-3" style={{ background: 'rgba(13,13,13,0.85)' }}>
                  <h2 className="text-[12px] font-semibold text-[#555] uppercase tracking-[0.08em] flex items-center gap-1.5">
                    <Lock className="w-3 h-3" /> Queued
                  </h2>
                  <span className="bg-[#222] text-[#555] text-xs px-2 py-0.5 rounded-full border border-[#2e2e2e]">
                    {lockedTasks.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {lockedTasks.map(task => (
                    <LockedTaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Ops Manager Dashboard ──────────────────────────────────────────────────

function OpsManagerDashboard({ currentUser, tasks, reviewTasks, episodesProgress, userQuotas, monthlyOutput, onTaskClick, onTaskUpdate, onReassignToast, onPendingAction }: {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  reviewTasks: (Task & { episode: Episode })[]
  episodesProgress: EpisodeProgress[]
  userQuotas: UserQuota[]
  monthlyOutput: MonthlyOutputMap
  onTaskClick: (task: Task & { episode?: Episode }) => void
  onTaskUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
  onPendingAction: (label: string, revert: () => void, commit: (silent: boolean) => Promise<void>) => void
}) {
  const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status as TaskStatus) && t.track !== 'Client Action')
  const clientActionTasks = tasks.filter(t => t.track === 'Client Action' && ACTIVE_STATUSES.includes(t.status as TaskStatus))
  const overdueCount = activeTasks.filter(t => isOverdue(t.due_date, t.status, t.requires_approval, t.review_started_at)).length
  const myQuotas = userQuotas.filter(q => q.user_id === currentUser.id)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px] font-bold text-white">Hey, {currentUser.name.split(' ')[0]}</h1>
        <p className="text-[#888] text-[15px] mt-1">
          {activeTasks.length} active task{activeTasks.length !== 1 ? 's' : ''}
          {overdueCount > 0 && <span className="ml-2 text-[#ff3c00] font-medium">· {overdueCount} overdue</span>}
          {reviewTasks.length > 0 && <span className="ml-2 text-purple-400">· {reviewTasks.length} awaiting review</span>}
        </p>
      </div>

      {myQuotas.length > 0 && (
        <OutputQuotaCard
          quotas={myQuotas}
          output={monthlyOutput[currentUser.id] ?? {}}
        />
      )}

      <div className="grid grid-cols-1 min-[900px]:grid-cols-2 items-start" style={{ gap: 0 }}>
        {/* Zone 1: My Tasks */}
        <div
          className="space-y-4"
          style={{
            padding: 24,
            paddingLeft: 0,
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <ZoneHeader title="My Tasks" count={activeTasks.length} />
          {activeTasks.length === 0 && tasks.filter(t => t.status === 'locked').length === 0 ? (
            <EmptyZone message="No active tasks right now" />
          ) : (
            <MyTasksList tasks={tasks} currentUser={currentUser} onTaskClick={onTaskClick} onTaskUpdate={onTaskUpdate} onReassignToast={onReassignToast} onPendingAction={onPendingAction} />
          )}
        </div>

        {/* Zone 2: Review Queue */}
        <div
          className="space-y-4"
          style={{
            padding: 24,
            paddingRight: 0,
          }}
        >
          <ZoneHeader title="Review Queue" count={reviewTasks.length} color="purple" />
          {reviewTasks.length === 0 ? (
            <EmptyZone message="No tasks awaiting review" />
          ) : (
            <div className="dashboard-scroll-column space-y-2 overflow-y-auto pr-2" style={{ maxHeight: '620px' }}>
              {reviewTasks.map(task => (
                <ReviewTaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} showAssignee />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Waiting for Client */}
      {clientActionTasks.length > 0 && (
        <div className="space-y-4">
          <ZoneHeader title="Waiting for Client" count={clientActionTasks.length} color="pink" />
          <div className="space-y-2">
            {clientActionTasks.map(task => (
              <ReviewTaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} showAssignee={false} />
            ))}
          </div>
        </div>
      )}

      {/* Mini Production Overview */}
      {episodesProgress.length > 0 && (
        <div className="space-y-4">
          <ZoneHeader title="Production Overview" count={episodesProgress.length} />
          <MiniProductionOverview episodes={episodesProgress} />
        </div>
      )}

      {/* Monthly Workload Metrics */}
      <WorkloadMetricsCard />
    </div>
  )
}

// ─── Admin Dashboard ─────────────────────────────────────────────────────────

function AdminDashboard({ currentUser, tasks, reviewTasks, episodesProgress, atRiskTasks, upcomingReleases, teamTasks, allUsers, userQuotas, monthlyOutput, onTaskClick, onTaskUpdate, onReassignToast, onPendingAction }: {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  reviewTasks: (Task & { episode: Episode })[]
  episodesProgress: EpisodeProgress[]
  atRiskTasks: (Task & { episode: Episode })[]
  upcomingReleases: Episode[]
  teamTasks: (Task & { episode: Episode })[]
  allUsers: User[]
  userQuotas: UserQuota[]
  monthlyOutput: MonthlyOutputMap
  onTaskClick: (task: Task & { episode?: Episode }) => void
  onTaskUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
  onPendingAction: (label: string, revert: () => void, commit: (silent: boolean) => Promise<void>) => void
}) {
  const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status as TaskStatus) && t.track !== 'Client Action')
  const clientActionTasks = tasks.filter(t => t.track === 'Client Action' && ACTIVE_STATUSES.includes(t.status as TaskStatus))
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // Group at-risk tasks by assignee for team overdue view
  const teamOverdueMap = atRiskTasks.reduce<Record<string, { user: User; count: number }>>((acc, t) => {
    const assignee = t.assignee as User | undefined
    if (!assignee) return acc
    if (!acc[assignee.id]) acc[assignee.id] = { user: assignee, count: 0 }
    acc[assignee.id].count++
    return acc
  }, {})
  const teamOverdue = Object.values(teamOverdueMap).sort((a, b) => b.count - a.count)

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <div>
        <h1 className="text-[28px] font-bold text-white">
          {greeting}, {currentUser.name.split(' ')[0]}
        </h1>
        <p className="text-[#888] text-[15px] mt-1">
          {activeTasks.length} task{activeTasks.length !== 1 ? 's' : ''} assigned to you
          {atRiskTasks.length > 0 && (
            <span className="ml-2 text-[#ff3c00] font-medium">
              · {atRiskTasks.length} at risk across the team
            </span>
          )}
        </p>
      </div>

      {/* Zone 1 + Zone 2 side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        {/* Zone 1: My Tasks */}
        <div className="space-y-4">
          <ZoneHeader title="My Tasks" count={activeTasks.length} />
          {activeTasks.length === 0 && tasks.filter(t => t.status === 'locked').length === 0 ? (
            <EmptyZone message="No active tasks assigned to you" />
          ) : (
            <MyTasksList tasks={tasks} currentUser={currentUser} onTaskClick={onTaskClick} onTaskUpdate={onTaskUpdate} onReassignToast={onReassignToast} onPendingAction={onPendingAction} />
          )}
        </div>

        {/* Zone 2: Needs Your Approval */}
        <div className="space-y-4">
          <ZoneHeader title="Needs Your Approval" count={reviewTasks.length} color="purple" />
          {reviewTasks.length === 0 ? (
            <EmptyZone message="No pending approvals" />
          ) : (
            <div className="dashboard-scroll-column space-y-2 overflow-y-auto pr-2" style={{ maxHeight: '620px' }}>
              {reviewTasks.map(task => (
                <ReviewTaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} showAssignee />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zone 2b: Waiting for Client */}
      {clientActionTasks.length > 0 && (
        <div className="space-y-4">
          <ZoneHeader title="Waiting for Client" count={clientActionTasks.length} color="pink" />
          <div className="space-y-2">
            {clientActionTasks.map(task => (
              <ReviewTaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} showAssignee={false} />
            ))}
          </div>
        </div>
      )}

      {/* Zone 3: Studio Overview */}
      <div className="space-y-6">
        <ZoneHeader title="Studio Overview" />

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard
            icon={<AlertTriangle className="w-4 h-4" style={{ color: atRiskTasks.length > 0 ? '#ff3c00' : '#444' }} />}
            label="At Risk"
            value={atRiskTasks.length}
            valueColor={atRiskTasks.length > 0 ? '#ff3c00' : '#555'}
          />
          <StatCard
            icon={<Users className="w-4 h-4" style={{ color: teamOverdue.length > 0 ? '#f59e0b' : '#444' }} />}
            label="Members Overdue"
            value={teamOverdue.length}
            valueColor={teamOverdue.length > 0 ? '#f59e0b' : '#555'}
          />
          <StatCard
            icon={<Calendar className="w-4 h-4" style={{ color: upcomingReleases.length > 0 ? '#60a5fa' : '#444' }} />}
            label="Upcoming Releases"
            value={upcomingReleases.length}
            valueColor={upcomingReleases.length > 0 ? '#60a5fa' : '#555'}
          />
        </div>

        {/* At Risk tasks */}
        {atRiskTasks.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-[12px] font-semibold text-[#ff3c00] uppercase tracking-[0.08em]">At Risk</h3>
            <div className="space-y-2">
              {atRiskTasks.slice(0, 8).map(task => (
                <AtRiskTaskRow key={task.id} task={task} onClick={() => onTaskClick(task)} />
              ))}
              {atRiskTasks.length > 8 && (
                <p className="text-sm text-[#555] pl-1">+{atRiskTasks.length - 8} more overdue tasks</p>
              )}
            </div>
          </div>
        )}

        {/* Team overdue members */}
        {teamOverdue.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-[12px] font-semibold text-amber-500 uppercase tracking-[0.08em]">Team Overdue</h3>
            <div className="flex flex-wrap gap-3">
              {teamOverdue.map(({ user, count }) => (
                <Link
                  key={user.id}
                  href={`/board?member=${user.id}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 group transition-all"
                  style={{ background: '#1a1a1a', border: '1px solid rgba(245,158,11,0.25)' }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = '#222'
                    el.style.borderColor = 'rgba(247,147,26,0.4)'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.background = '#1a1a1a'
                    el.style.borderColor = 'rgba(245,158,11,0.25)'
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: user.avatar_color || '#444' }}
                  >
                    {user.name[0].toUpperCase()}
                  </div>
                  <span className="text-sm text-white font-medium">{user.name.split(' ')[0]}</span>
                  <span className="text-xs font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">
                    {count}
                  </span>
                  <span className="text-[#555] opacity-0 group-hover:opacity-100 transition-opacity text-sm ml-0.5">→</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Releases */}
        {upcomingReleases.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-[12px] font-semibold text-blue-400 uppercase tracking-[0.08em]">Upcoming Releases</h3>
            <div className="space-y-2">
              {upcomingReleases.map(ep => (
                <UpcomingReleaseRow key={ep.id} episode={ep} />
              ))}
            </div>
          </div>
        )}

        {/* Mini Production Overview */}
        {episodesProgress.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-[12px] font-semibold text-[#888] uppercase tracking-[0.08em]">Active Episodes</h3>
            <MiniProductionOverview episodes={episodesProgress} />
          </div>
        )}
      </div>

      {/* Zone 4: Team Workload */}
      <div className="space-y-4">
        <ZoneHeader title="Team Workload" count={teamTasks.length} />
        <WorkloadSection teamTasks={teamTasks} allUsers={allUsers} onTaskClick={onTaskClick} />
      </div>

      {/* Zone 5: Monthly Workload Metrics */}
      <WorkloadMetricsCard allUsers={allUsers} />

      {/* Zone 6: Monthly Output (quota tracking) */}
      {userQuotas.length > 0 && (
        <MonthlyOutputSection
          quotas={userQuotas}
          monthlyOutput={monthlyOutput}
          allUsers={allUsers}
        />
      )}
    </div>
  )
}

// ─── Team Workload ───────────────────────────────────────────────────────────

const ROLE_LABELS_SHORT: Record<string, string> = {
  admin: 'Admin',
  ops_manager: 'Ops',
  member: 'Member',
}

function WorkloadSection({ teamTasks, allUsers, onTaskClick }: {
  teamTasks: (Task & { episode: Episode })[]
  allUsers: User[]
  onTaskClick: (task: Task & { episode?: Episode }) => void
}) {
  const tasksByUser = teamTasks.reduce<Record<string, (Task & { episode: Episode })[]>>((acc, t) => {
    const id = t.assignee_id
    if (!id) return acc
    if (!acc[id]) acc[id] = []
    acc[id].push(t)
    return acc
  }, {})

  const withTasks = allUsers.filter(u => (tasksByUser[u.id] || []).length > 0)
    .sort((a, b) => (tasksByUser[b.id]?.length ?? 0) - (tasksByUser[a.id]?.length ?? 0))
  const withoutTasks = allUsers.filter(u => !tasksByUser[u.id]?.length)

  if (allUsers.length === 0) return <p className="text-sm text-[#555]">No team members found.</p>

  return (
    <div className="space-y-3">
      {withTasks.map(user => (
        <WorkloadPersonCard
          key={user.id}
          user={user}
          tasks={tasksByUser[user.id] || []}
          onTaskClick={onTaskClick}
        />
      ))}

      {withoutTasks.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {withoutTasks.map(user => (
            <div
              key={user.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 opacity-40"
                style={{ background: user.avatar_color || '#444' }}
              >
                {user.name[0].toUpperCase()}
              </div>
              <span className="text-xs text-[#444]">{user.name.split(' ')[0]}</span>
              <span className="text-[10px] text-[#333]">no tasks</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkloadPersonCard({ user, tasks, onTaskClick }: {
  user: User
  tasks: (Task & { episode: Episode })[]
  onTaskClick: (task: Task & { episode?: Episode }) => void
}) {
  const overdue = tasks.filter(t => isOverdue(t.due_date, t.status, t.requires_approval, t.review_started_at))

  return (
    <div className="rounded-xl overflow-hidden bg-[#141414]" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      {/* Person header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: '#1a1a1a', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={user.name} color={user.avatar_color} size="sm" avatarUrl={user.avatar_url} />
          <span className="text-sm font-semibold text-white truncate">{user.name}</span>
          <span className="text-[11px] text-[#555]">{ROLE_LABELS_SHORT[user.role] ?? user.role}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {overdue.length > 0 && (
            <span className="text-[11px] font-semibold text-[#ff3c00] bg-[#ff3c00]/10 px-2 py-0.5 rounded-full">
              {overdue.length} overdue
            </span>
          )}
          <span className="text-[11px] text-[#666] bg-[#222] border border-[#2a2a2a] px-2 py-0.5 rounded-full">
            {tasks.length} active
          </span>
        </div>
      </div>

      {/* Task rows */}
      <div>
        {tasks.map(task => (
          <WorkloadTaskRow key={task.id} task={task} onTaskClick={onTaskClick} />
        ))}
      </div>
    </div>
  )
}

function WorkloadTaskRow({ task, onTaskClick }: {
  task: Task & { episode: Episode }
  onTaskClick: (task: Task & { episode?: Episode }) => void
}) {
  const late = isOverdue(task.due_date, task.status, task.requires_approval, task.review_started_at)
  const trackColor = (TRACK_COLORS as Record<string, string>)[task.track] || '#444'

  return (
    <button
      onClick={() => onTaskClick(task)}
      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors text-left border-b last:border-0"
      style={{ borderColor: 'rgba(255,255,255,0.04)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: trackColor }} />
      <span className="flex-1 text-sm text-white truncate min-w-0">{task.label}</span>
      <span className="text-xs text-[#555] shrink-0 hidden sm:block truncate max-w-[140px]">
        {task.episode?.guest_name}
        {task.episode?.client_label ? ` · ${task.episode.client_label}` : ''}
      </span>
      <VersionBadge version={task.submission_count} />
      <StatusBadge status={task.status as TaskStatus} />
      <span className={cn('text-xs shrink-0 tabular-nums', late ? 'text-[#ff3c00] font-medium' : 'text-[#555]')}>
        {formatDate(task.due_date)}
      </span>
    </button>
  )
}

// ─── Output Quota Card (personal — member / ops_manager) ────────────────────

function OutputQuotaCard({ quotas, output }: {
  quotas: UserQuota[]
  output: Record<string, number>  // track → quantity done this month
}) {
  const now = new Date()
  const monthName = now.toLocaleString('default', { month: 'long' })

  return (
    <div
      className="rounded-xl px-5 py-4 space-y-3"
      style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <p className="text-[11px] font-semibold text-[#555] uppercase tracking-wider">{monthName} Output</p>
      <div className="space-y-3">
        {quotas.map(q => {
          const done = output[q.track] ?? 0
          const pct = Math.min(100, Math.round((done / q.monthly_cap) * 100))
          const isOver = done >= q.monthly_cap
          const isNearing = !isOver && pct >= 80
          const barColor = isOver ? '#ff3c00' : isNearing ? '#f59e0b' : '#f7931a'
          return (
            <div key={q.id}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-white">{q.track}</span>
                <span className={cn('text-sm font-semibold tabular-nums', isOver ? 'text-[#ff3c00]' : isNearing ? 'text-amber-400' : 'text-white')}>
                  {done} <span className="text-[#555] font-normal">/ {q.monthly_cap}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#242424' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: barColor }}
                />
              </div>
              {isOver && (
                <p className="text-[11px] text-[#ff3c00] mt-1">Cap reached — {done - q.monthly_cap} over limit</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Monthly Output Section (admin view — all team members) ─────────────────

function MonthlyOutputSection({ quotas, monthlyOutput, allUsers }: {
  quotas: UserQuota[]
  monthlyOutput: MonthlyOutputMap
  allUsers: User[]
}) {
  const now = new Date()
  const monthName = now.toLocaleString('default', { month: 'long' })

  return (
    <div className="space-y-4">
      <ZoneHeader title={`${monthName} Output`} />
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Header */}
        <div
          className="grid grid-cols-[1fr_140px_180px] gap-4 px-5 py-3"
          style={{ background: '#1a1a1a', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          {['Member', 'Track', 'Progress'].map(h => (
            <span key={h} className="text-[11px] font-semibold text-[#555] uppercase tracking-wider">{h}</span>
          ))}
        </div>

        {quotas.map(q => {
          const member = allUsers.find(u => u.id === q.user_id)
          const done = (monthlyOutput[q.user_id] ?? {})[q.track] ?? 0
          const pct = Math.min(100, Math.round((done / q.monthly_cap) * 100))
          const isOver = done >= q.monthly_cap
          const isNearing = !isOver && pct >= 80
          const barColor = isOver ? '#ff3c00' : isNearing ? '#f59e0b' : '#f7931a'

          return (
            <div
              key={q.id}
              className="grid grid-cols-[1fr_140px_180px] gap-4 items-center px-5 py-3 border-b last:border-0"
              style={{ borderColor: 'rgba(255,255,255,0.05)' }}
            >
              {/* Member */}
              <div className="flex items-center gap-2 min-w-0">
                {member && <Avatar name={member.name} color={member.avatar_color} size="sm" avatarUrl={member.avatar_url} />}
                <span className="text-sm text-white truncate">{member?.name ?? '—'}</span>
              </div>

              {/* Track */}
              <span className="text-xs px-2 py-1 rounded-md w-fit" style={{ background: 'rgba(255,255,255,0.06)', color: '#aaa' }}>{q.track}</span>

              {/* Progress */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#242424' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: barColor }}
                  />
                </div>
                <span className={cn('text-sm font-semibold tabular-nums shrink-0', isOver ? 'text-[#ff3c00]' : isNearing ? 'text-amber-400' : 'text-[#888]')}>
                  {done}/{q.monthly_cap}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Shared sub-components ──────────────────────────────────────────────────

function ZoneHeader({ title, count, color = 'default' }: { title: string; count?: number; color?: 'default' | 'purple' | 'pink' }) {
  const countCls = color === 'purple'
    ? 'bg-purple-500/20 text-purple-400'
    : color === 'pink'
    ? 'bg-fuchsia-500/20 text-fuchsia-400'
    : 'bg-[#222] text-[#888] border border-[#2a2a2a]'
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="text-[15px] font-bold text-white">{title}</h2>
      {count !== undefined && (
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', countCls)}>
          {count}
        </span>
      )}
    </div>
  )
}

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[12px] font-semibold text-[#888] uppercase tracking-[0.08em]">{label}</h2>
      <span className="text-[#888] text-[12px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}>
        {count}
      </span>
    </div>
  )
}

function EmptyZone({ message }: { message: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-12 text-center rounded-xl bg-[#141414]"
      style={{ border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <Clock className="w-7 h-7 text-[#2a2a2a] mb-2.5" />
      <p className="text-[#444] text-sm">{message}</p>
    </div>
  )
}

function StatCard({ icon, label, value, valueColor }: { icon: React.ReactNode; label: string; value: number; valueColor: string }) {
  return (
    <div className="rounded-xl p-5 space-y-3" style={{ background: '#171717', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-2 text-[#666] text-[11px] font-semibold uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <span className="text-4xl font-black block" style={{ color: valueColor }}>{value}</span>
    </div>
  )
}

function MyTasksList({ tasks, currentUser, onTaskClick, onTaskUpdate, onReassignToast, onPendingAction }: {
  tasks: (Task & { episode: Episode })[]
  currentUser: User
  onTaskClick: (task: Task & { episode?: Episode }) => void
  onTaskUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
  onPendingAction?: (label: string, revert: () => void, commit: (silent: boolean) => Promise<void>) => void
}) {
  // Exclude Client Action tasks — they have their own section
  const nonClientTasks = tasks.filter(t => t.track !== 'Client Action')
  const activeTasks = nonClientTasks.filter(t => ACTIVE_STATUSES.includes(t.status as TaskStatus))
  const lockedTasks = nonClientTasks.filter(t => t.status === 'locked')
  const grouped = ACTIVE_STATUSES.reduce<Record<TaskStatus, (Task & { episode: Episode })[]>>(
    (acc, s) => { acc[s] = activeTasks.filter(t => t.status === s); return acc },
    {} as Record<TaskStatus, (Task & { episode: Episode })[]>
  )

  return (
    <div className="dashboard-scroll-column space-y-6 overflow-y-auto pr-2" style={{ maxHeight: '620px' }}>
      {ACTIVE_STATUSES.map(status => {
        const statusTasks = grouped[status]
        if (!statusTasks || statusTasks.length === 0) return null
        return (
          <div key={status}>
            <div className="sticky top-0 z-[5] -mx-1 px-1 py-1 backdrop-blur-sm" style={{ background: 'rgba(13,13,13,0.85)' }}>
              <SectionLabel label={STATUS_LABELS[status]} count={statusTasks.length} />
            </div>
            <div className="space-y-2 mt-3">
              {statusTasks.map(task => (
                <TaskCard key={task.id} task={task} currentUser={currentUser} onClick={() => onTaskClick(task)} onUpdate={onTaskUpdate} onReassignToast={onReassignToast} onPendingAction={onPendingAction} />
              ))}
            </div>
          </div>
        )
      })}
      {activeTasks.length === 0 && (
        <p className="text-sm text-[#555] text-center py-4">No active tasks</p>
      )}
      {lockedTasks.length > 0 && (
        <div>
          <div className="sticky top-0 z-[5] -mx-1 px-1 py-1 backdrop-blur-sm flex items-center gap-2 mb-3" style={{ background: 'rgba(13,13,13,0.85)' }}>
            <h3 className="text-[12px] font-semibold text-[#555] uppercase tracking-[0.08em] flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Queued
              <InfoIcon text="These tasks are waiting for other tasks to be completed first. They will unlock automatically once their dependencies are approved." />
            </h3>
            <span className="bg-[#222] text-[#555] text-xs px-2 py-0.5 rounded-full border border-[#2e2e2e]">
              {lockedTasks.length}
            </span>
          </div>
          <div className="space-y-2">
            {lockedTasks.map(task => (
              <LockedTaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AtRiskTaskRow({ task, onClick }: { task: Task & { episode: Episode }; onClick: () => void }) {
  const daysOverdue = task.due_date
    ? differenceInDays(new Date(), parseDate(task.due_date))
    : null
  const hoursInReview = task.status === 'in_review' && task.review_started_at
    ? differenceInHours(new Date(), parseDate(task.review_started_at))
    : null
  const assignee = task.assignee as User | undefined

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg px-4 py-3 flex items-center gap-3 transition-colors"
      style={{ background: '#1a1a1a', border: '1px solid rgba(255,60,0,0.25)' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,60,0,0.5)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,60,0,0.25)')}
    >
      {assignee && (
        <div
          className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
          style={{ background: assignee.avatar_color || '#444' }}
          title={assignee.name}
        >
          {assignee.name[0].toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-white truncate">{task.label}</p>
        <p className="text-[12px] text-[#666] truncate">
          {assignee?.name} · {task.episode?.guest_name} · {task.episode?.client_label}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        {daysOverdue !== null && daysOverdue > 0 && (
          <span className="text-[11px] font-bold text-[#ff3c00]">{daysOverdue}d overdue</span>
        )}
        {hoursInReview !== null && hoursInReview > 0 && daysOverdue === null && (
          <span className="text-[11px] font-bold text-purple-400">{hoursInReview}h in review</span>
        )}
        <div className="flex items-center gap-1.5">
          <VersionBadge version={task.submission_count} />
          <StatusBadge status={task.status} />
        </div>
      </div>
    </button>
  )
}

function UpcomingReleaseRow({ episode }: { episode: Episode }) {
  const daysUntil = episode.release_date
    ? differenceInDays(new Date(episode.release_date + 'T00:00:00'), startOfToday())
    : null
  const releaseDateColor =
    daysUntil === null ? '#60a5fa'
    : daysUntil < 1  ? '#ff3c00'   // red — today or past
    : daysUntil <= 3 ? '#facc15'   // yellow — 1–3 days
    : '#60a5fa'                    // blue — 4+ days

  return (
    <Link
      href={`/episodes/${episode.id}`}
      className="flex items-center gap-4 rounded-lg px-4 py-3 transition-colors"
      style={{ background: '#1a1a1a', border: '1px solid rgba(96,165,250,0.2)' }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.5)')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.2)')}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-white truncate">{episode.guest_name}</p>
        <p className="text-[12px] text-[#666] truncate">{episode.client_label}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[12px] font-bold" style={{ color: releaseDateColor }}>
          {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`}
        </p>
        <p className="text-[11px] text-[#555]">
          {episode.release_date ? format(new Date(episode.release_date + 'T00:00:00'), 'MMM d') : '—'}
        </p>
      </div>
    </Link>
  )
}

function MiniProductionOverview({ episodes }: { episodes: EpisodeProgress[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
      {episodes.map(ep => {
        const pct = ep.totalTasks > 0 ? Math.round((ep.doneTasks / ep.totalTasks) * 100) : 0
        const daysUntil = ep.release_date
          ? differenceInDays(new Date(ep.release_date + 'T00:00:00'), startOfToday())
          : null
        const releaseSoon = daysUntil !== null && daysUntil >= 0 && daysUntil <= 7
        const miniDateColor =
          daysUntil === null   ? '#444'
          : daysUntil < 1     ? '#ff3c00'
          : daysUntil <= 3    ? '#facc15'
          : daysUntil <= 7    ? '#60a5fa'
          : '#444'
        const borderColor = ep.overdueTasks > 0
          ? 'rgba(255,60,0,0.4)'
          : releaseSoon
          ? 'rgba(251,191,36,0.4)'
          : 'rgba(255,255,255,0.08)'

        return (
          <Link
            key={ep.id}
            href={`/episodes/${ep.id}`}
            className="shrink-0 w-[200px] rounded-xl p-4 transition-all hover:opacity-90"
            style={{ background: '#1a1a1a', border: `1px solid ${borderColor}` }}
          >
            <p className="text-[11px] text-[#555] truncate">{ep.client_label}</p>
            <p className="text-[13px] font-semibold text-white truncate mt-0.5">{ep.guest_name}</p>
            <div className="mt-3 h-1.5 rounded-full bg-[#2a2a2a] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: ep.overdueTasks > 0 ? '#ff3c00' : '#16a34a',
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[11px] text-[#555]">{ep.doneTasks}/{ep.totalTasks} done</span>
              {daysUntil !== null && (
                <span className="text-[11px] font-bold" style={{ color: miniDateColor }}>
                  {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : daysUntil > 0 ? `${daysUntil}d` : format(new Date(ep.release_date + 'T00:00:00'), 'MMM d')}
                </span>
              )}
            </div>
            {ep.overdueTasks > 0 && (
              <p className="text-[11px] text-[#ff3c00] font-medium mt-1">
                {ep.overdueTasks} overdue
              </p>
            )}
          </Link>
        )
      })}
    </div>
  )
}

// ─── Task cards (shared) ────────────────────────────────────────────────────

function LockedTaskCard({ task, onClick }: { task: Task & { episode: Episode }; onClick: () => void }) {
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS] || '#888'
  return (
    <div
      onClick={onClick}
      className="w-full text-left rounded-lg p-4 opacity-50 hover:opacity-70 transition-opacity cursor-pointer"
      style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.09)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor }} />
            <span className="text-sm text-[#666] truncate">
              {task.episode?.guest_name} · {task.episode?.client_label}
            </span>
          </div>
          <p className="text-base font-medium text-[#888]">{task.label}</p>
          <p className="text-sm text-[#555] mt-0.5">{task.track}</p>
          {task.dep_task_ids.length > 0 && (
            <p className="text-[11px] text-[#444] mt-1">Waiting on prior tasks to complete</p>
          )}
          <div className="mt-2">
            <Link
              href={`/episodes/${task.episode_id}`}
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-[11px] font-medium text-[#666] hover:text-white transition-colors"
              title="Open project"
            >
              <ArrowRight className="w-3 h-3" />
              Project
            </Link>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-[#555] bg-[#222] px-2 py-0.5 rounded-full border border-[#2e2e2e]">
            <Lock className="w-3 h-3" /> Locked
          </div>
          {task.due_date && (
            <span className="text-sm text-[#555]">{formatDate(task.due_date)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function ReviewTaskCard({ task, onClick, showAssignee = false }: {
  task: Task & { episode: Episode }
  onClick: () => void
  showAssignee?: boolean
}) {
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS] || '#888'
  const overdue = isOverdue(task.due_date, task.status, task.requires_approval, task.review_started_at)

  return (
    <div
      onClick={onClick}
      className="w-full text-left rounded-lg p-4 cursor-pointer transition-all"
      style={{ background: '#1e1e1e', border: '1px solid rgba(168,85,247,0.3)' }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(168,85,247,0.6)')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(168,85,247,0.3)')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor }} />
            <span className="text-sm text-[#888] truncate">
              {task.episode?.guest_name} · {task.episode?.client_label}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-medium text-white">{task.label}</p>
            <VersionBadge version={task.submission_count} />
          </div>
          <p className="text-[13px] text-[#888] mt-0.5">
            {task.track}{showAssignee && task.assignee ? ` · ${(task.assignee as User).name}` : ''}
          </p>
          <div className="mt-2">
            <Link
              href={`/episodes/${task.episode_id}`}
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-[11px] font-medium text-[#888] hover:text-white transition-colors"
              title="Open project"
            >
              <ArrowRight className="w-3 h-3" />
              Project
            </Link>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {task.due_date && (
            <div className={cn('flex items-center gap-1 text-sm', overdue ? 'text-[#ff3c00]' : 'text-[#666]')}>
              {overdue && <AlertCircle className="w-3 h-3" />}
              <span>{formatDate(task.due_date)}</span>
            </div>
          )}
          {task.review_started_at && (() => {
            const hrs = differenceInHours(new Date(), parseDate(task.review_started_at))
            if (hrs <= 0) return null
            const color = hrs >= 12 ? 'text-[#ff3c00]' : hrs >= 6 ? 'text-amber-400' : 'text-[#666]'
            return (
              <div className="flex items-center gap-1">
                <span className={cn('text-[11px] font-medium', color)}>{hrs}h waiting</span>
                <InfoIcon text="Tasks in review are flagged after 6 hours (amber) and 12 hours (red). Approvals should be completed within 12 hours to keep production on track." />
              </div>
            )
          })()}
          <span className="px-3 py-1.5 bg-purple-500/20 text-purple-300 text-xs font-bold rounded-full whitespace-nowrap">
            Review →
          </span>
        </div>
      </div>
    </div>
  )
}

function getActionLabel(task: Task): string {
  if (task.status === 'in_progress') return task.requires_approval ? 'Submit for Review' : 'Mark Complete'
  if (task.status === 'in_review') return 'Review'
  if (task.status === 'revision') return 'Resubmit'
  return ''
}

function TaskCard({ task, currentUser, onClick, onUpdate, onReassignToast, onPendingAction }: {
  task: Task & { episode: Episode }
  currentUser: User
  onClick: () => void
  onUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
  onPendingAction?: (label: string, revert: () => void, commit: (silent: boolean) => Promise<void>) => void
}) {
  const supabase = createClient()
  const [acting, setActing] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [comments, setComments] = useState<Array<{ id: string; body: string; created_at: string; author_id: string; author: { name: string; avatar_color: string; avatar_url: string | null } | null; reactions: { emoji: string; user_id: string }[] }>>([])
  const [commentCount, setCommentCount] = useState<number | null>(null)
  const [newComment, setNewComment] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [commentHoverId, setCommentHoverId] = useState<string | null>(null)
  const [nextUserForNote, setNextUserForNote] = useState<{ user: User; taskId: string } | null>(null)
  const overdue = isOverdue(task.due_date, task.status, task.requires_approval, task.review_started_at)
  const hoursUntilDue = task.due_date ? differenceInHours(parseDate(task.due_date), new Date()) : null
  const isDueSoon = !overdue && hoursUntilDue !== null && hoursUntilDue >= 0 && hoursUntilDue <= 24
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS] || '#888'

  // Eagerly determine next person for inline note
  useEffect(() => {
    setNoteText('')
    setNextUserForNote(null)
    if (task.status === 'in_review') return // opens modal, no note here

    async function compute() {
      const rawNext: TaskStatus =
        task.status === 'in_progress' ? 'in_review' :
        task.status === 'revision' ? 'in_review' : task.status
      const nextStatus: TaskStatus =
        rawNext === 'in_review' && !task.requires_approval ? 'done' : rawNext

      if (nextStatus === 'in_review' && task.approver_id && task.approver_id !== currentUser.id) {
        const approver = (task as Task & { approver?: User }).approver
        if (approver?.name) {
          setNextUserForNote({ user: approver, taskId: task.id })
        } else {
          const { data } = await supabase.from('users').select('*').eq('id', task.approver_id).single()
          if (data) setNextUserForNote({ user: data as User, taskId: task.id })
        }
      } else if (nextStatus === 'done') {
        // Find downstream locked task that will be unlocked
        const { data: allTasks } = await supabase
          .from('tasks').select('id, status, dep_task_ids, assignee_id').eq('episode_id', task.episode_id)
        if (!allTasks) return
        const approvedIds = new Set([
          ...allTasks.filter(t => t.status === 'approved' || t.status === 'done').map(t => t.id),
          task.id,
        ])
        const unlocking = allTasks.find(t =>
          t.status === 'locked' && t.dep_task_ids.length > 0 &&
          t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
        )
        if (unlocking && unlocking.assignee_id !== currentUser.id) {
          const { data } = await supabase.from('users').select('*').eq('id', unlocking.assignee_id).single()
          if (data) setNextUserForNote({ user: data as User, taskId: unlocking.id })
        }
      }
    }
    compute()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.status])

  async function maybePostNote() {
    if (!noteText.trim() || !nextUserForNote) return
    const body = `→ ${nextUserForNote.user.name}: ${noteText.trim()}`
    const { data: comment } = await supabase
      .from('comments')
      .insert({ task_id: nextUserForNote.taskId, episode_id: task.episode_id, author_id: currentUser.id, body, internal: false })
      .select('id').single()
    if (comment) {
      fetch('/api/notifications/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentId: comment.id, authorId: currentUser.id,
          taskId: nextUserForNote.taskId, episodeId: task.episode_id,
          body, assigneeId: nextUserForNote.user.id,
        }),
      }).catch(() => {})
    }
  }

  async function loadComments() {
    const { data } = await supabase
      .from('comments')
      .select('id, body, created_at, author_id, author:users!author_id(name, avatar_color, avatar_url)')
      .eq('task_id', task.id)
      .eq('internal', false)
      .order('created_at', { ascending: true })
    if (data) {
      const normalized = (data as any[]).map(c => ({
        id: c.id as string,
        body: c.body as string,
        created_at: c.created_at as string,
        author_id: c.author_id as string,
        author: Array.isArray(c.author) ? (c.author[0] ?? null) : (c.author ?? null),
        reactions: [] as { emoji: string; user_id: string }[],
      }))

      // Load reactions for these comments
      const ids = normalized.map(c => c.id)
      if (ids.length > 0) {
        const { data: rxData } = await supabase
          .from('comment_reactions')
          .select('comment_id, emoji, user_id')
          .in('comment_id', ids)
        if (rxData) {
          const rxMap: Record<string, { emoji: string; user_id: string }[]> = {}
          for (const r of rxData) {
            if (!rxMap[r.comment_id]) rxMap[r.comment_id] = []
            rxMap[r.comment_id].push({ emoji: r.emoji, user_id: r.user_id })
          }
          for (const c of normalized) c.reactions = rxMap[c.id] ?? []
        }
      }

      setComments(normalized)
      setCommentCount(normalized.length)
      setCommentsLoaded(true)
    }
  }

  function handleToggleComments(e: React.MouseEvent) {
    e.stopPropagation()
    if (!commentsOpen && !commentsLoaded) loadComments()
    setCommentsOpen(o => !o)
  }

  async function handleSendComment(e: React.MouseEvent) {
    e.stopPropagation()
    const body = newComment.trim()
    if (!body || sendingComment) return
    setSendingComment(true)
    const { data: comment } = await supabase
      .from('comments')
      .insert({ task_id: task.id, episode_id: task.episode_id, author_id: currentUser.id, body, internal: false })
      .select('id, body, created_at').single()
    if (comment) {
      const entry = { id: comment.id, body: comment.body, created_at: comment.created_at, author_id: currentUser.id, author: { name: currentUser.name, avatar_color: currentUser.avatar_color, avatar_url: currentUser.avatar_url }, reactions: [] as { emoji: string; user_id: string }[] }
      setComments(prev => [...prev, entry])
      setCommentCount(prev => (prev ?? 0) + 1)
      setNewComment('')
      fetch('/api/notifications/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId: comment.id, authorId: currentUser.id, taskId: task.id, episodeId: task.episode_id, body, assigneeId: task.assignee_id }),
      }).catch(() => {})
    }
    setSendingComment(false)
  }

  function toggleCommentReaction(commentId: string, emoji: string, e: React.MouseEvent) {
    e.stopPropagation()
    setComments(prev => prev.map(c => {
      if (c.id !== commentId) return c
      const has = c.reactions.some(r => r.emoji === emoji && r.user_id === currentUser.id)
      return { ...c, reactions: has ? c.reactions.filter(r => !(r.emoji === emoji && r.user_id === currentUser.id)) : [...c.reactions, { emoji, user_id: currentUser.id }] }
    }))
    fetch(`/api/comments/${commentId}/react`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }),
    }).catch(console.error)
  }

  function startEditComment(comment: typeof comments[0], e: React.MouseEvent) {
    e.stopPropagation()
    setEditingCommentId(comment.id)
    setEditDraft(comment.body)
  }

  async function saveEditComment(commentId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const trimmed = editDraft.trim()
    if (!trimmed) return
    const original = comments.find(c => c.id === commentId)?.body ?? ''
    setComments(prev => prev.map(c => c.id === commentId ? { ...c, body: trimmed } : c))
    setEditingCommentId(null)
    const res = await fetch(`/api/comments/${commentId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: trimmed }),
    })
    if (!res.ok) setComments(prev => prev.map(c => c.id === commentId ? { ...c, body: original } : c))
  }

  function deleteComment(commentId: string, e: React.MouseEvent) {
    e.stopPropagation()
    setComments(prev => prev.filter(c => c.id !== commentId))
    setCommentCount(prev => (prev ?? 1) - 1)
    fetch(`/api/comments/${commentId}`, { method: 'DELETE' }).catch(console.error)
  }

  function handleAction(e: React.MouseEvent) {
    e.stopPropagation()
    if (task.status === 'in_review') { onClick(); return }

    const rawNext: TaskStatus =
      task.status === 'in_progress' ? 'in_review' :
      task.status === 'revision' ? 'in_review' : task.status
    const nextStatus: TaskStatus =
      rawNext === 'in_review' && !task.requires_approval ? 'done' : rawNext

    const originalTask = task
    const capturedNote = noteText
    const capturedNextUser = nextUserForNote
    const actionLabel =
      nextStatus === 'in_review' ? `Submitted "${task.label}" for review`
      : `Marked "${task.label}" as done`

    onUpdate({ ...task, status: nextStatus } as unknown as Task)

    const commit = async (silent: boolean) => {
      if (!silent && capturedNote.trim() && capturedNextUser) {
        const body = `→ ${capturedNextUser.user.name}: ${capturedNote.trim()}`
        const { data: comment } = await supabase.from('comments').insert({ task_id: capturedNextUser.taskId, episode_id: task.episode_id, author_id: currentUser.id, body, internal: false }).select('id').single()
        if (comment) fetch('/api/notifications/comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commentId: comment.id, authorId: currentUser.id, taskId: capturedNextUser.taskId, episodeId: task.episode_id, body, assigneeId: capturedNextUser.user.id }) }).catch(() => {})
      }

      const updatePayload: Record<string, unknown> = { status: nextStatus }
      if (nextStatus === 'in_review') updatePayload.review_started_at = new Date().toISOString()
      const { data, error } = await supabase.from('tasks').update(updatePayload).eq('id', task.id).select('*').single()
      if (error) { onUpdate(originalTask as unknown as Task); return }
      if (!data) return

      onUpdate(data as unknown as Task)
      markTaskNotificationsRead(supabase, currentUser.id, task.id).catch(() => {})
      supabase.from('task_history').insert({ task_id: originalTask.id, episode_id: originalTask.episode_id, from_status: originalTask.status, to_status: nextStatus, changed_by: currentUser.id }).then(() => {})

      // Trigger downstream unlock + auto-archive cascade. Pass silent through
      // so an auto-archive triggered by this action also stays silent.
      fetch('/api/tasks/unlock-deps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: task.episode_id, silent }),
      }).catch(() => {})

      if (nextStatus === 'done') {
        fetch('/api/episodes/check-triggers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, episodeId: task.episode_id }) }).catch(() => {})
      }
      if (!silent && nextStatus === 'in_review' && task.requires_approval && task.approver_id && task.approver_id !== currentUser.id) {
        const nextVersion = (task.submission_count ?? 0) + 1
        const versionTag = nextVersion > 0 ? ` (v${nextVersion})` : ''
        supabase.from('notifications').insert({ user_id: task.approver_id, type: 'task_submitted_review', title: 'Task submitted for review', body: `${currentUser.name} submitted "${task.label}"${versionTag} for review`, task_id: task.id, episode_id: task.episode_id, read: false }).then(() => {})
        fetch('/api/slack/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'review_submitted', episodeId: task.episode_id, taskLabel: task.label, assigneeName: currentUser.name, version: nextVersion }) }).catch(() => {})
      }
    }

    if (onPendingAction) {
      onPendingAction(actionLabel, () => onUpdate(originalTask as unknown as Task), commit)
    } else {
      commit(false).catch(console.error)
    }
  }

  const firstName = nextUserForNote?.user.name.split(' ')[0]
  const canReassign = currentUser.role === 'admin' || currentUser.role === 'ops_manager'
  const taskAssignee = (task as Task & { assignee?: User }).assignee

  return (
    <div
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg p-4 transition-all cursor-pointer',
        overdue ? 'shadow-[0_0_14px_rgba(255,60,0,0.2)]' : isDueSoon ? 'shadow-[0_0_14px_rgba(234,179,8,0.2)]' : ''
      )}
      style={{
        background: '#1e1e1e',
        border: overdue ? '1px solid rgba(255,60,0,0.5)' : isDueSoon ? '1px solid rgba(234,179,8,0.5)' : '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor }} />
            <span className="text-sm text-[#888] truncate">
              {task.episode?.guest_name} · {task.episode?.client_label}
            </span>
          </div>
          <p className="text-[15px] font-medium text-white">{task.label}</p>
          <p className="text-[13px] text-[#888] mt-0.5">{task.track}</p>
          {task.episode?.footage_url && ['Trailer', 'Clips & Shorts', 'Long-form'].includes(task.track) && (
            <a
              href={task.episode.footage_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs text-[#f7931a]/70 hover:text-[#f7931a] transition-colors mt-0.5 inline-block"
            >
              Footage →
            </a>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <VersionBadge version={task.submission_count} />
            <StatusBadge status={task.status} />
          </div>
          {task.due_date && (
            <div className={cn('flex items-center gap-1 text-sm', overdue ? 'text-[#ff3c00]' : 'text-[#666]')}>
              {overdue && <AlertCircle className="w-3 h-3" />}
              <span>{formatDate(task.due_date)}</span>
            </div>
          )}
        </div>
        <button
          onClick={handleAction}
          disabled={acting}
          className="shrink-0 px-3 py-1.5 bg-[#f7931a] hover:bg-[#e07d10] disabled:opacity-50 text-black text-xs font-bold rounded-full transition-colors whitespace-nowrap"
        >
          {acting ? '...' : getActionLabel(task)}
        </button>
      </div>
      {/* Task brief — auto-expanded so the assignee can't miss it */}
      {task.brief && (
        <div
          className="mt-3 px-3 py-2.5 rounded-lg"
          style={{ background: 'rgba(247,147,26,0.06)', border: '1px solid rgba(247,147,26,0.15)' }}
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[10px] font-semibold text-[#f7931a]/60 uppercase tracking-wider mb-1.5">Brief</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.82)' }}>
            {renderBriefBody(task.brief)}
          </p>
        </div>
      )}
      {nextUserForNote && task.status !== 'in_review' && (
        <div className="mt-3 space-y-1" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <Avatar name={nextUserForNote.user.name} color={nextUserForNote.user.avatar_color} size="sm" avatarUrl={nextUserForNote.user.avatar_url} />
            <span className="text-xs text-[#555]">
              Note for <span className="text-[#888] font-medium">{firstName}</span> <span className="text-[#444]">(optional)</span>
            </span>
          </div>
          <textarea
            value={noteText}
            onChange={e => { if (e.target.value.length <= 300) setNoteText(e.target.value) }}
            placeholder={`Note for ${firstName}…`}
            rows={2}
            className="w-full px-2.5 py-2 bg-[#141414] border border-[#2e2e2e] rounded-lg text-xs text-white placeholder-[#444] resize-none focus:outline-none focus:ring-1 focus:ring-[#ff3c00] leading-relaxed"
          />
        </div>
      )}
      {/* Footer: assignee + Reassign on the left, action pills on the right */}
      <div className="mt-3 pt-3 border-t border-[#222] flex items-center justify-between gap-2" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 min-w-0">
          {canReassign && taskAssignee && !['done', 'approved'].includes(task.status) ? (
            <>
              <Avatar name={taskAssignee.name} color={taskAssignee.avatar_color} size="sm" avatarUrl={taskAssignee.avatar_url} />
              <span className="text-xs text-[#666] truncate">{taskAssignee.name}</span>
              <button
                onClick={() => setReassignOpen(o => !o)}
                className="text-[11px] text-[#f7931a]/60 hover:text-[#f7931a] hover:underline cursor-pointer transition-colors ml-1 shrink-0"
              >
                Reassign
              </button>
            </>
          ) : taskAssignee ? (
            <>
              <Avatar name={taskAssignee.name} color={taskAssignee.avatar_color} size="sm" avatarUrl={taskAssignee.avatar_url} />
              <span className="text-xs text-[#666] truncate">{taskAssignee.name}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            href={`/episodes/${task.episode_id}`}
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-[11px] font-medium text-[#888] hover:text-white transition-colors"
            title="Open project"
          >
            <ArrowRight className="w-3 h-3" />
            Project
          </Link>
          <button
            onClick={handleToggleComments}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors',
              commentsOpen
                ? 'bg-[#f7931a]/15 border-[#f7931a]/40 text-[#f7931a]'
                : 'bg-[#1a1a1a] hover:bg-[#222] border-[#2a2a2a] text-[#888] hover:text-white'
            )}
            title={commentsOpen ? 'Close comments' : 'Show comments'}
          >
            <MessageSquare className="w-3 h-3" />
            {commentCount ?? 0}
          </button>
        </div>
      </div>
      {reassignOpen && (
        <div onClick={e => e.stopPropagation()}>
          <ReassignDropdown
            task={task}
            currentUser={currentUser}
            episode={task.episode}
            onReassigned={(updated, msg) => {
              onUpdate(updated)
              setReassignOpen(false)
              onReassignToast?.(msg)
            }}
            onClose={() => setReassignOpen(false)}
          />
        </div>
      )}

      {commentsOpen && (
        <div className="mt-3 pt-3 border-t border-[#222] space-y-3" onClick={e => e.stopPropagation()}>
          {!commentsLoaded ? (
            <p className="text-xs text-[#555] text-center py-1">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-[#555]">No comments yet</p>
          ) : (
            <div className="space-y-2.5">
              {comments.slice(-3).map(c => {
                const isOwn = c.author_id === currentUser.id
                const isEditing = editingCommentId === c.id
                const isHovered = commentHoverId === c.id
                return (
                  <div
                    key={c.id}
                    className="flex gap-2"
                    onMouseEnter={() => setCommentHoverId(c.id)}
                    onMouseLeave={() => setCommentHoverId(null)}
                  >
                    {c.author && (
                      <Avatar name={c.author.name} color={c.author.avatar_color} avatarUrl={c.author.avatar_url} size="sm" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-medium text-[#ccc]">{c.author?.name ?? 'Unknown'}</span>
                        <span className="text-[10px] text-[#444]">{format(new Date(c.created_at), 'MMM d')}</span>
                        {isOwn && isHovered && !isEditing && (
                          <>
                            <button onClick={e => startEditComment(c, e)} className="p-0.5 text-[#444] hover:text-[#888] transition-colors">
                              <Pencil className="w-2.5 h-2.5" />
                            </button>
                            <button onClick={e => deleteComment(c.id, e)} className="p-0.5 text-[#444] hover:text-[#ff6644] transition-colors">
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </>
                        )}
                      </div>
                      {isEditing ? (
                        <div onClick={e => e.stopPropagation()}>
                          <textarea
                            value={editDraft}
                            onChange={e => setEditDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditComment(c.id, e as any) } if (e.key === 'Escape') setEditingCommentId(null) }}
                            autoFocus
                            rows={2}
                            className="w-full mt-1 px-2 py-1.5 bg-[#141414] border border-[#f7931a]/40 rounded text-xs text-white resize-none focus:outline-none leading-snug"
                          />
                          <div className="flex gap-3 mt-1">
                            <button onClick={e => { e.stopPropagation(); setEditingCommentId(null) }} className="text-[10px] text-[#555] hover:text-[#888]">Cancel</button>
                            <button onClick={e => saveEditComment(c.id, e)} className="text-[10px] text-[#f7931a] font-semibold hover:text-[#e07d10]">Save</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-[#aaa] leading-snug break-words">{c.body}</p>
                      )}
                      {/* Reactions */}
                      {!isEditing && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {['👍', '✅', '🔥'].map(emoji => {
                            const count = c.reactions.filter(r => r.emoji === emoji).length
                            const isMine = c.reactions.some(r => r.emoji === emoji && r.user_id === currentUser.id)
                            if (count === 0 && !isHovered) return null
                            return (
                              <button
                                key={emoji}
                                onClick={e => toggleCommentReaction(c.id, emoji, e)}
                                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] transition-all select-none ${isMine ? 'bg-[#f7931a]/15 border border-[#f7931a]/40 text-[#f7931a]' : 'bg-[#1e1e1e] border border-[#2a2a2a] text-[#555] hover:text-[#aaa]'}`}
                              >
                                <span>{emoji}</span>
                                {count > 0 && <span className="text-[9px] font-medium ml-0.5">{count}</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <Link
                href={`/episodes/${task.episode_id}?t=${task.id}`}
                onClick={e => e.stopPropagation()}
                className="text-[11px] text-[#f7931a]/70 hover:text-[#f7931a] transition-colors block"
              >
                See more in project →
              </Link>
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendComment(e as any) } }}
              placeholder="Leave a comment…"
              rows={2}
              className="flex-1 px-2.5 py-2 bg-[#141414] border border-[#2e2e2e] rounded-lg text-xs text-white placeholder-[#444] resize-none focus:outline-none focus:ring-1 focus:ring-[#f7931a] leading-relaxed"
            />
            <button
              onClick={handleSendComment}
              disabled={!newComment.trim() || sendingComment}
              className="p-2 rounded-lg bg-[#f7931a] disabled:opacity-30 text-black transition-opacity shrink-0"
            >
              <SendHorizonal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

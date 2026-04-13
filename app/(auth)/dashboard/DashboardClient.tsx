'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AlertCircle, Clock, Lock, CheckCircle, AlertTriangle, Calendar, Users } from 'lucide-react'
import { differenceInDays, differenceInHours, format, parseISO } from 'date-fns'
import { Task, Episode, User, TaskStatus } from '@/lib/types'
import { StatusBadge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { cn, formatDate, isOverdue, STATUS_LABELS } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { TaskModal } from '@/components/tasks/TaskModal'
import { ReassignDropdown } from '@/components/tasks/ReassignDropdown'
import { InfoIcon } from '@/components/ui/InfoIcon'
import { createClient } from '@/lib/supabase/client'
import type { EpisodeProgress } from './page'

const ACTIVE_STATUSES: TaskStatus[] = ['ready', 'in_progress', 'in_review', 'revision']

interface Props {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  reviewTasks: (Task & { episode: Episode })[]
  episodesProgress: EpisodeProgress[]
  atRiskTasks: (Task & { episode: Episode })[]
  upcomingReleases: Episode[]
}

export function DashboardClient({
  currentUser,
  tasks: initialTasks,
  reviewTasks: initialReviewTasks,
  episodesProgress,
  atRiskTasks,
  upcomingReleases,
}: Props) {
  const supabase = createClient()
  const [tasks, setTasks] = useState(initialTasks)
  const [reviewTasks, setReviewTasks] = useState(initialReviewTasks)
  const [selectedTask, setSelectedTask] = useState<(Task & { episode?: Episode }) | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Realtime: my tasks
  useEffect(() => {
    const channel = supabase
      .channel(`dash-my-tasks-${currentUser.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${currentUser.id}` },
        async (payload) => {
          const updated = payload.new as Task
          if (updated.status === 'done' || updated.status === 'approved') {
            setTasks(prev => prev.filter(t => t.id !== updated.id))
          } else {
            const { data } = await supabase
              .from('tasks')
              .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*), episode:episodes(*)')
              .eq('id', updated.id)
              .single()
            if (data) {
              setTasks(prev => {
                const exists = prev.find(t => t.id === data.id)
                if (exists) return prev.map(t => t.id === data.id ? data as unknown as Task & { episode: Episode } : t)
                return [...prev, data as unknown as Task & { episode: Episode }]
              })
            }
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
              if (data) {
                setReviewTasks(prev => {
                  const exists = prev.find(t => t.id === data.id)
                  if (exists) return prev.map(t => t.id === data.id ? data as unknown as Task & { episode: Episode } : t)
                  return [...prev, data as unknown as Task & { episode: Episode }]
                })
              }
            }
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser.id, currentUser.role])

  function handleTaskUpdate(updated: Task) {
    if (updated.status === 'done' || updated.status === 'approved') {
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
          onTaskClick={setSelectedTask}
          onTaskUpdate={handleTaskUpdate}
          onReassignToast={setToast}
        />
      )}

      {currentUser.role === 'ops_manager' && (
        <OpsManagerDashboard
          currentUser={currentUser}
          tasks={tasks}
          reviewTasks={reviewTasks}
          episodesProgress={episodesProgress}
          onTaskClick={setSelectedTask}
          onTaskUpdate={handleTaskUpdate}
          onReassignToast={setToast}
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
          onTaskClick={setSelectedTask}
          onTaskUpdate={handleTaskUpdate}
          onReassignToast={setToast}
        />
      )}

      {selectedTask && (
        <TaskModal
          task={selectedTask as Task}
          currentUser={currentUser}
          episode={selectedTask.episode ?? undefined}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => { handleTaskUpdate(updated); setSelectedTask(prev => prev ? { ...prev, ...updated } : null) }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-sm font-medium text-white shadow-xl"
          style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.15)' }}>
          {toast}
        </div>
      )}
    </>
  )
}

// ─── Member Dashboard ───────────────────────────────────────────────────────

function MemberDashboard({ currentUser, tasks, onTaskClick, onTaskUpdate, onReassignToast }: {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  onTaskClick: (task: Task & { episode?: Episode }) => void
  onTaskUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
}) {
  const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status as TaskStatus))
  const lockedTasks = tasks.filter(t => t.status === 'locked')
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

          <div className="space-y-8">
            {ACTIVE_STATUSES.map(status => {
              const statusTasks = grouped[status]
              if (!statusTasks || statusTasks.length === 0) return null
              const hasOverdue = statusTasks.some(t => isOverdue(t.due_date, t.status, t.requires_approval, t.review_started_at))
              return (
                <div key={status} id={hasOverdue ? 'overdue-section' : undefined}>
                  <SectionLabel label={STATUS_LABELS[status]} count={statusTasks.length} />
                  <div className="space-y-2 mt-3">
                    {statusTasks.map(task => (
                      <TaskCard key={task.id} task={task} currentUser={currentUser} onClick={() => onTaskClick(task)} onUpdate={onTaskUpdate} onReassignToast={onReassignToast} />
                    ))}
                  </div>
                </div>
              )
            })}

            {lockedTasks.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
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

function OpsManagerDashboard({ currentUser, tasks, reviewTasks, episodesProgress, onTaskClick, onTaskUpdate, onReassignToast }: {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  reviewTasks: (Task & { episode: Episode })[]
  episodesProgress: EpisodeProgress[]
  onTaskClick: (task: Task & { episode?: Episode }) => void
  onTaskUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
}) {
  const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status as TaskStatus))
  const overdueCount = activeTasks.filter(t => isOverdue(t.due_date, t.status, t.requires_approval, t.review_started_at)).length

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

      <div className="grid grid-cols-1 min-[900px]:grid-cols-2 items-start" style={{ gap: 0 }}>
        {/* Zone 1: My Tasks */}
        <div
          className="space-y-4 overflow-y-auto"
          style={{
            padding: 24,
            paddingLeft: 0,
            borderRight: '1px solid rgba(255,255,255,0.06)',
            maxHeight: 'calc(100vh - 200px)',
          }}
        >
          <ZoneHeader title="My Tasks" count={activeTasks.length} />
          {activeTasks.length === 0 && tasks.filter(t => t.status === 'locked').length === 0 ? (
            <EmptyZone message="No active tasks right now" />
          ) : (
            <MyTasksList tasks={tasks} currentUser={currentUser} onTaskClick={onTaskClick} onTaskUpdate={onTaskUpdate} onReassignToast={onReassignToast} />
          )}
        </div>

        {/* Zone 2: Review Queue */}
        <div
          className="space-y-4 overflow-y-auto"
          style={{
            padding: 24,
            paddingRight: 0,
            maxHeight: 'calc(100vh - 200px)',
          }}
        >
          <ZoneHeader title="Review Queue" count={reviewTasks.length} color="purple" />
          {reviewTasks.length === 0 ? (
            <EmptyZone message="No tasks awaiting review" />
          ) : (
            <div className="space-y-2">
              {reviewTasks.map(task => (
                <ReviewTaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} showAssignee />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mini Production Overview */}
      {episodesProgress.length > 0 && (
        <div className="space-y-4">
          <ZoneHeader title="Production Overview" count={episodesProgress.length} />
          <MiniProductionOverview episodes={episodesProgress} />
        </div>
      )}
    </div>
  )
}

// ─── Admin Dashboard ─────────────────────────────────────────────────────────

function AdminDashboard({ currentUser, tasks, reviewTasks, episodesProgress, atRiskTasks, upcomingReleases, onTaskClick, onTaskUpdate, onReassignToast }: {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  reviewTasks: (Task & { episode: Episode })[]
  episodesProgress: EpisodeProgress[]
  atRiskTasks: (Task & { episode: Episode })[]
  upcomingReleases: Episode[]
  onTaskClick: (task: Task & { episode?: Episode }) => void
  onTaskUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
}) {
  const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status as TaskStatus))
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
            <MyTasksList tasks={tasks} currentUser={currentUser} onTaskClick={onTaskClick} onTaskUpdate={onTaskUpdate} onReassignToast={onReassignToast} />
          )}
        </div>

        {/* Zone 2: Needs Your Approval */}
        <div className="space-y-4">
          <ZoneHeader title="Needs Your Approval" count={reviewTasks.length} color="purple" />
          {reviewTasks.length === 0 ? (
            <EmptyZone message="No pending approvals" />
          ) : (
            <div className="space-y-2">
              {reviewTasks.map(task => (
                <ReviewTaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} showAssignee />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zone 3: Studio Overview */}
      <div className="space-y-6">
        <ZoneHeader title="Studio Overview" />

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4">
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
    </div>
  )
}

// ─── Shared sub-components ──────────────────────────────────────────────────

function ZoneHeader({ title, count, color = 'default' }: { title: string; count?: number; color?: 'default' | 'purple' }) {
  const countCls = color === 'purple'
    ? 'bg-purple-500/20 text-purple-400'
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
      className="flex flex-col items-center justify-center py-12 text-center rounded-xl"
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

function MyTasksList({ tasks, currentUser, onTaskClick, onTaskUpdate, onReassignToast }: {
  tasks: (Task & { episode: Episode })[]
  currentUser: User
  onTaskClick: (task: Task & { episode?: Episode }) => void
  onTaskUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
}) {
  const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status as TaskStatus))
  const lockedTasks = tasks.filter(t => t.status === 'locked')
  const grouped = ACTIVE_STATUSES.reduce<Record<TaskStatus, (Task & { episode: Episode })[]>>(
    (acc, s) => { acc[s] = activeTasks.filter(t => t.status === s); return acc },
    {} as Record<TaskStatus, (Task & { episode: Episode })[]>
  )

  return (
    <div className="space-y-6">
      {ACTIVE_STATUSES.map(status => {
        const statusTasks = grouped[status]
        if (!statusTasks || statusTasks.length === 0) return null
        return (
          <div key={status}>
            <SectionLabel label={STATUS_LABELS[status]} count={statusTasks.length} />
            <div className="space-y-2 mt-3">
              {statusTasks.map(task => (
                <TaskCard key={task.id} task={task} currentUser={currentUser} onClick={() => onTaskClick(task)} onUpdate={onTaskUpdate} onReassignToast={onReassignToast} />
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
          <div className="flex items-center gap-2 mb-3">
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
    ? differenceInDays(new Date(), parseISO(task.due_date))
    : null
  const hoursInReview = task.status === 'in_review' && task.review_started_at
    ? differenceInHours(new Date(), parseISO(task.review_started_at))
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
        <StatusBadge status={task.status} />
      </div>
    </button>
  )
}

function UpcomingReleaseRow({ episode }: { episode: Episode }) {
  const daysUntil = episode.release_date
    ? differenceInDays(parseISO(episode.release_date), new Date())
    : null
  const urgent = daysUntil !== null && daysUntil <= 3

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
        <p className="text-[12px] font-bold" style={{ color: urgent ? '#ff3c00' : '#60a5fa' }}>
          {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`}
        </p>
        <p className="text-[11px] text-[#555]">
          {episode.release_date ? format(parseISO(episode.release_date), 'MMM d') : '—'}
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
          ? differenceInDays(parseISO(ep.release_date), new Date())
          : null
        const releaseSoon = daysUntil !== null && daysUntil >= 0 && daysUntil <= 7
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
                <span className={cn('text-[11px]', releaseSoon ? 'text-amber-400 font-bold' : 'text-[#444]')}>
                  {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : daysUntil > 0 ? `${daysUntil}d` : format(parseISO(ep.release_date), 'MMM d')}
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
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg p-4 opacity-50 hover:opacity-70 transition-opacity"
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
    </button>
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
          <p className="text-[15px] font-medium text-white">{task.label}</p>
          <p className="text-[13px] text-[#888] mt-0.5">
            {task.track}{showAssignee && task.assignee ? ` · ${(task.assignee as User).name}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {task.due_date && (
            <div className={cn('flex items-center gap-1 text-sm', overdue ? 'text-[#ff3c00]' : 'text-[#666]')}>
              {overdue && <AlertCircle className="w-3 h-3" />}
              <span>{formatDate(task.due_date)}</span>
            </div>
          )}
          {task.review_started_at && (() => {
            const hrs = differenceInHours(new Date(), parseISO(task.review_started_at))
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
  if (task.status === 'in_progress' || task.status === 'ready') return task.requires_approval ? 'Submit for Review' : 'Mark Complete'
  if (task.status === 'in_review') return 'Review'
  if (task.status === 'revision') return 'Resubmit'
  return ''
}

function TaskCard({ task, currentUser, onClick, onUpdate, onReassignToast }: {
  task: Task & { episode: Episode }
  currentUser: User
  onClick: () => void
  onUpdate: (task: Task) => void
  onReassignToast?: (msg: string) => void
}) {
  const supabase = createClient()
  const [acting, setActing] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [nextUserForNote, setNextUserForNote] = useState<{ user: User; taskId: string } | null>(null)
  const overdue = isOverdue(task.due_date, task.status, task.requires_approval, task.review_started_at)
  const hoursUntilDue = task.due_date ? differenceInHours(parseISO(task.due_date), new Date()) : null
  const isDueSoon = !overdue && hoursUntilDue !== null && hoursUntilDue >= 0 && hoursUntilDue <= 24
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS] || '#888'

  // Eagerly determine next person for inline note
  useEffect(() => {
    setNoteText('')
    setNextUserForNote(null)
    if (task.status === 'in_review') return // opens modal, no note here

    async function compute() {
      const rawNext: TaskStatus =
        task.status === 'ready' || task.status === 'in_progress' ? 'in_review' :
        task.status === 'revision' ? 'in_review' : task.status
      const nextStatus: TaskStatus =
        rawNext === 'in_review' && !task.requires_approval ? 'approved' : rawNext

      if (nextStatus === 'in_review' && task.approver_id && task.approver_id !== currentUser.id) {
        const approver = (task as Task & { approver?: User }).approver
        if (approver?.name) {
          setNextUserForNote({ user: approver, taskId: task.id })
        } else {
          const { data } = await supabase.from('users').select('*').eq('id', task.approver_id).single()
          if (data) setNextUserForNote({ user: data as User, taskId: task.id })
        }
      } else if (nextStatus === 'approved') {
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

  async function handleAction(e: React.MouseEvent) {
    e.stopPropagation()
    if (task.status === 'in_review') { onClick(); return }

    const rawNext: TaskStatus =
      task.status === 'ready' || task.status === 'in_progress' ? 'in_review' :
      task.status === 'revision' ? 'in_review' : task.status
    const nextStatus: TaskStatus =
      rawNext === 'in_review' && !task.requires_approval ? 'approved' : rawNext

    setActing(true)
    await maybePostNote()

    const updatePayload: Record<string, unknown> = { status: nextStatus }
    if (nextStatus === 'in_review') updatePayload.review_started_at = new Date().toISOString()
    const { data } = await supabase
      .from('tasks').update(updatePayload).eq('id', task.id)
      .select('*').single()

    if (data) {
      onUpdate(data as unknown as Task)
      if (nextStatus === 'approved') {
        fetch('/api/episodes/check-triggers', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, episodeId: task.episode_id }),
        }).catch(() => {})
      }
      if (nextStatus === 'in_review' && task.requires_approval) {
        if (task.approver_id && task.approver_id !== currentUser.id) {
          await supabase.from('notifications').insert({
            user_id: task.approver_id, type: 'task_submitted_review',
            title: 'Task submitted for review',
            body: `${currentUser.name} submitted "${task.label}" for review`,
            task_id: task.id, episode_id: task.episode_id, read: false,
          })
        }
        fetch('/api/slack/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'review_submitted', episodeId: task.episode_id, taskLabel: task.label, assigneeName: currentUser.name }),
        }).catch(() => {})
      }
    }
    setActing(false)
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
          <StatusBadge status={task.status} />
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
      {canReassign && taskAssignee && !['done', 'approved'].includes(task.status) && (
        <div className="mt-3 pt-3 border-t border-[#222]" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <Avatar name={taskAssignee.name} color={taskAssignee.avatar_color} size="sm" avatarUrl={taskAssignee.avatar_url} />
            <span className="text-xs text-[#666]">{taskAssignee.name}</span>
            <button
              onClick={() => setReassignOpen(o => !o)}
              className="text-[11px] text-[#f7931a]/60 hover:text-[#f7931a] hover:underline cursor-pointer transition-colors ml-1"
            >
              Reassign
            </button>
          </div>
          {reassignOpen && (
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
          )}
        </div>
      )}
    </div>
  )
}

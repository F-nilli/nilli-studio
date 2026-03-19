'use client'

import { useState } from 'react'
import { AlertCircle, Clock, Lock } from 'lucide-react'
import { Task, Episode, User, TaskStatus } from '@/lib/types'
import { StatusBadge } from '@/components/ui/Badge'
import { cn, formatDate, isOverdue, STATUS_LABELS } from '@/lib/utils'
import { differenceInHours, parseISO } from 'date-fns'
import { TRACK_COLORS } from '@/lib/constants'
import { TaskModal } from '@/components/tasks/TaskModal'
import { createClient } from '@/lib/supabase/client'

const ACTIVE_STATUSES: TaskStatus[] = ['ready', 'in_progress', 'in_review', 'revision']

interface Props {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  reviewTasks?: (Task & { episode: Episode })[]
}

export function DashboardClient({ currentUser, tasks: initialTasks, reviewTasks: initialReviewTasks = [] }: Props) {
  const [tasks, setTasks] = useState(initialTasks)
  const [reviewTasks, setReviewTasks] = useState(initialReviewTasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  function handleTaskUpdate(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t))
    // Remove from review queue once approved/revised (no longer in_review)
    if (updated.status !== 'in_review') {
      setReviewTasks(prev => prev.filter(t => t.id !== updated.id))
    }
    if (selectedTask?.id === updated.id) setSelectedTask(updated)
  }

  const activeTasks = tasks.filter(t => ACTIVE_STATUSES.includes(t.status as TaskStatus))
  const lockedTasks = tasks.filter(t => t.status === 'locked')

  const grouped = ACTIVE_STATUSES.reduce<Record<TaskStatus, (Task & { episode: Episode })[]>>(
    (acc, status) => {
      acc[status] = tasks.filter(t => t.status === status)
      return acc
    },
    {} as Record<TaskStatus, (Task & { episode: Episode })[]>
  )

  const overdueCount = activeTasks.filter(t => isOverdue(t.due_date, t.status, t.requires_approval, t.review_started_at)).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white">
          Hey, {currentUser.name.split(' ')[0]}
        </h1>
        <p className="text-[#888] text-base mt-1">
          {activeTasks.length} active task{activeTasks.length !== 1 ? 's' : ''}
          {lockedTasks.length > 0 && (
            <span className="ml-2 text-[#555]">· {lockedTasks.length} upcoming</span>
          )}
          {overdueCount > 0 && (
            <span className="ml-2 text-[#ff3c00] font-medium">· {overdueCount} overdue</span>
          )}
        </p>
      </div>

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

      {/* Needs Review section — for admins/ops_managers */}
      {reviewTasks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider">Needs Review</h2>
            <span className="bg-purple-500/20 text-purple-400 text-xs font-medium px-2 py-0.5 rounded-full">
              {reviewTasks.length}
            </span>
          </div>
          <div className="space-y-2">
            {reviewTasks.map(task => (
              <ReviewTaskCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-8">
        {/* Active task groups */}
        {ACTIVE_STATUSES.map(status => {
          const statusTasks = grouped[status]
          if (statusTasks.length === 0) return null
          const hasOverdue = statusTasks.some(t => isOverdue(t.due_date, t.status, t.requires_approval, t.review_started_at))
          return (
            <div key={status} id={hasOverdue ? 'overdue-section' : undefined}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-[#888] uppercase tracking-wider">
                  {STATUS_LABELS[status]}
                </h2>
                <span className="bg-[#1e1e1e] text-[#888] text-xs font-medium px-2 py-0.5 rounded-full">
                  {statusTasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {statusTasks.map(task => (
                  <TaskCard key={task.id} task={task} currentUser={currentUser} onClick={() => setSelectedTask(task)} onUpdate={handleTaskUpdate} />
                ))}
              </div>
            </div>
          )
        })}

        {activeTasks.length === 0 && (
          <div className="text-center py-10 text-[#555]">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-bold text-white text-lg">No active tasks right now</p>
            <p className="text-base mt-1">Your upcoming tasks are listed below</p>
          </div>
        )}

        {/* Locked / upcoming tasks */}
        {lockedTasks.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold text-[#555] uppercase tracking-wider flex items-center gap-2">
                <Lock className="w-3.5 h-3.5" />
                Queued
              </h2>
              <span className="bg-[#222] text-[#555] text-xs font-medium px-2 py-0.5 rounded-full border border-[#2e2e2e]">
                {lockedTasks.length}
              </span>
            </div>
            <div className="space-y-2">
              {lockedTasks.map(task => (
                <LockedTaskCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          currentUser={currentUser}
          episode={selectedTask?.episode ?? undefined}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => { handleTaskUpdate(updated); setSelectedTask(updated) }}
        />
      )}
    </div>
  )
}

function LockedTaskCard({ task, onClick }: { task: Task & { episode: Episode }; onClick: () => void }) {
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS] || '#888'

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[#181818] border border-[#242424] rounded-lg p-4 opacity-50 hover:opacity-70 transition-opacity group"
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
            <Lock className="w-3 h-3" />
            Locked
          </div>
          {task.due_date && (
            <span className="text-sm text-[#555]">{formatDate(task.due_date)}</span>
          )}
        </div>
      </div>
    </button>
  )
}

function ReviewTaskCard({ task, onClick }: { task: Task & { episode: Episode }; onClick: () => void }) {
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS] || '#888'
  const overdue = isOverdue(task.due_date, task.status, task.requires_approval, task.review_started_at)

  return (
    <div
      onClick={onClick}
      className="w-full text-left bg-[#141414] border border-purple-500/30 rounded-lg p-4 cursor-pointer hover:border-purple-500/60 transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor }} />
            <span className="text-sm text-[#888] truncate">
              {task.episode?.guest_name} · {task.episode?.client_label}
            </span>
          </div>
          <p className="text-base font-medium text-white">{task.label}</p>
          <p className="text-sm text-[#888] mt-0.5">{task.track} · {task.assignee?.name}</p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {task.due_date && (
            <div className={cn('flex items-center gap-1 text-sm', overdue ? 'text-[#ff3c00]' : 'text-[#666]')}>
              {overdue && <AlertCircle className="w-3 h-3" />}
              <span>{formatDate(task.due_date)}</span>
            </div>
          )}
          <span className="px-3 py-1.5 bg-purple-500/20 text-purple-300 text-xs font-bold rounded-full whitespace-nowrap">
            Review →
          </span>
        </div>
      </div>
    </div>
  )
}

function getActionLabel(task: Task): string {
  if (task.status === 'ready') return 'Start'
  if (task.status === 'in_progress') return task.requires_approval ? 'Submit for Review' : 'Mark Complete'
  if (task.status === 'in_review') return 'Review'
  if (task.status === 'revision') return 'Resubmit'
  return ''
}

function TaskCard({ task, currentUser, onClick, onUpdate }: {
  task: Task & { episode: Episode }
  currentUser: User
  onClick: () => void
  onUpdate: (task: Task) => void
}) {
  const supabase = createClient()
  const [acting, setActing] = useState(false)
  const overdue = isOverdue(task.due_date, task.status, task.requires_approval, task.review_started_at)
  const hoursUntilDue = task.due_date ? differenceInHours(parseISO(task.due_date), new Date()) : null
  const isDueSoon = !overdue && hoursUntilDue !== null && hoursUntilDue >= 0 && hoursUntilDue <= 24
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS] || '#888'

  async function handleAction(e: React.MouseEvent) {
    e.stopPropagation()

    // in_review → open modal for approval/revision flow
    if (task.status === 'in_review') { onClick(); return }

    const rawNext: TaskStatus =
      task.status === 'ready' ? 'in_progress' :
      task.status === 'in_progress' ? 'in_review' :
      task.status === 'revision' ? 'in_review' : task.status

    // No approval needed: skip in_review, go straight to approved
    const nextStatus: TaskStatus =
      rawNext === 'in_review' && !task.requires_approval ? 'approved' : rawNext

    setActing(true)
    const updatePayload: Record<string, unknown> = { status: nextStatus }
    if (nextStatus === 'in_review') updatePayload.review_started_at = new Date().toISOString()
    const { data } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', task.id)
      .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*)')
      .single()

    if (data) {
      onUpdate(data as unknown as Task)
      if (nextStatus === 'in_review' && task.requires_approval) {
        // Notify the specific approver only
        if (task.approver_id && task.approver_id !== currentUser.id) {
          await supabase.from('notifications').insert({
            user_id: task.approver_id, type: 'task_submitted_review',
            title: 'Task submitted for review',
            body: `${currentUser.name} submitted "${task.label}" for review`,
            task_id: task.id, episode_id: task.episode_id, read: false,
          })
        }
        fetch('/api/slack/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'review_submitted', episodeId: task.episode_id, taskLabel: task.label, assigneeName: currentUser.name }),
        }).catch(() => {})
      }
    }
    setActing(false)
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        'w-full text-left bg-[#141414] border rounded-lg p-4 transition-all group cursor-pointer',
        overdue
          ? 'border-[#ff3c00]/50 shadow-[0_0_14px_rgba(255,60,0,0.2)] hover:border-[#ff3c00]/70'
          : isDueSoon
          ? 'border-yellow-500/50 shadow-[0_0_14px_rgba(234,179,8,0.2)] hover:border-yellow-500/70'
          : 'border-[#2e2e2e] hover:border-[#444]'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor }} />
            <span className="text-sm text-[#888] truncate">
              {task.episode?.guest_name} · {task.episode?.client_label}
            </span>
          </div>
          <p className="text-base font-medium text-white">{task.label}</p>
          <p className="text-sm text-[#888] mt-0.5">{task.track}</p>
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
    </div>
  )
}

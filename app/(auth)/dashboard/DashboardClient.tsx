'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Clock, ChevronRight } from 'lucide-react'
import { Task, Episode, User, TaskStatus } from '@/lib/types'
import { StatusBadge } from '@/components/ui/Badge'
import { cn, formatDate, isOverdue, STATUS_LABELS } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { TaskModal } from '@/components/tasks/TaskModal'

const DASHBOARD_STATUSES: TaskStatus[] = ['ready', 'in_progress', 'in_review', 'revision']

interface Props {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
}

export function DashboardClient({ currentUser, tasks }: Props) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const grouped = DASHBOARD_STATUSES.reduce<Record<TaskStatus, (Task & { episode: Episode })[]>>(
    (acc, status) => {
      acc[status] = tasks.filter(t => t.status === status)
      return acc
    },
    {} as Record<TaskStatus, (Task & { episode: Episode })[]>
  )

  const overdueCount = tasks.filter(t => isOverdue(t.due_date, t.status)).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Hey, {currentUser.name.split(' ')[0]} 👋
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {tasks.length} active task{tasks.length !== 1 ? 's' : ''}
            {overdueCount > 0 && (
              <span className="ml-2 text-red-500 font-medium">
                · {overdueCount} overdue
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Overdue Banner */}
      {overdueCount > 0 && (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400">
            You have {overdueCount} overdue task{overdueCount !== 1 ? 's' : ''}. Please review them below.
          </p>
        </div>
      )}

      {/* Task Groups */}
      <div className="space-y-8">
        {DASHBOARD_STATUSES.map(status => {
          const statusTasks = grouped[status]
          if (statusTasks.length === 0) return null

          return (
            <div key={status}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  {STATUS_LABELS[status]}
                </h2>
                <span className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium px-2 py-0.5 rounded-full">
                  {statusTasks.length}
                </span>
              </div>

              <div className="space-y-2">
                {statusTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => setSelectedTask(task)}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {tasks.length === 0 && (
          <div className="text-center py-16 text-gray-500 dark:text-gray-400">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No active tasks</p>
            <p className="text-sm mt-1">You&apos;re all caught up!</p>
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          currentUser={currentUser}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => setSelectedTask(updated)}
        />
      )}
    </div>
  )
}

function TaskCard({ task, onClick }: { task: Task & { episode: Episode }; onClick: () => void }) {
  const overdue = isOverdue(task.due_date, task.status)
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS] || '#gray'

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left bg-white dark:bg-gray-900 border rounded-lg p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-all group',
        overdue
          ? 'border-red-200 dark:border-red-800'
          : 'border-gray-200 dark:border-gray-800'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: trackColor }}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {task.episode?.guest_name} · {task.episode?.client_label}
            </span>
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{task.label}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{task.track}</p>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <StatusBadge status={task.status} />
          {task.due_date && (
            <div className={cn('flex items-center gap-1 text-xs', overdue ? 'text-red-500' : 'text-gray-400 dark:text-gray-500')}>
              {overdue && <AlertCircle className="w-3 h-3" />}
              <span>{formatDate(task.due_date)}</span>
            </div>
          )}
        </div>

        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 group-hover:text-gray-600 dark:group-hover:text-gray-300 mt-0.5 transition-colors" />
      </div>
    </button>
  )
}

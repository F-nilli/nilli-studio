'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, AlertCircle, ChevronRight, Calendar, Users } from 'lucide-react'
import { Episode, Task, User, TaskStatus } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { cn, formatDate, isOverdue } from '@/lib/utils'
import { parseISO, format, differenceInDays } from 'date-fns'

interface Props {
  currentUser: User
  episodes: Episode[]
  tasks: Task[]
  allUsers: User[]
}

function getEpisodeStats(tasks: Task[]) {
  const total = tasks.length
  const approved = tasks.filter(t => t.status === 'approved' || t.status === 'done').length
  const overdue = tasks.filter(t => isOverdue(t.due_date, t.status)).length
  const inProgress = tasks.filter(t => ['in_progress', 'in_review'].includes(t.status)).length
  const progress = total > 0 ? Math.round((approved / total) * 100) : 0
  return { total, approved, overdue, inProgress, progress }
}

function getActiveAssignees(tasks: Task[], allUsers: User[]) {
  const assigneeIds = new Set(
    tasks
      .filter(t => !['locked', 'approved', 'done'].includes(t.status))
      .map(t => t.assignee_id)
  )
  return allUsers.filter(u => assigneeIds.has(u.id))
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  locked: 0, ready: 1, in_progress: 2, in_review: 3,
  revision: 4, approved: 5, done: 6
}

function getEpisodeStatusColor(tasks: Task[]): string {
  if (tasks.some(t => t.status === 'in_review')) return 'bg-purple-500'
  if (tasks.some(t => t.status === 'revision')) return 'bg-red-500'
  if (tasks.some(t => isOverdue(t.due_date, t.status))) return 'bg-red-500'
  if (tasks.some(t => t.status === 'in_progress')) return 'bg-yellow-500'
  if (tasks.every(t => t.status === 'approved' || t.status === 'done')) return 'bg-green-500'
  return 'bg-blue-500'
}

export function BoardClient({ currentUser, episodes, tasks, allUsers }: Props) {
  const [filter, setFilter] = useState<'all' | 'active' | 'overdue'>('all')

  const episodesWithTasks = episodes.map(ep => ({
    ...ep,
    tasks: tasks.filter(t => t.episode_id === ep.id),
  }))

  const filteredEpisodes = episodesWithTasks.filter(ep => {
    const stats = getEpisodeStats(ep.tasks)
    if (filter === 'active') return stats.inProgress > 0 || ep.tasks.some(t => t.status === 'ready')
    if (filter === 'overdue') return stats.overdue > 0
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Production Board</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {episodes.length} episode{episodes.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <Link
          href="/episodes/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Episode
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {(['all', 'active', 'overdue'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize',
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Episode Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredEpisodes.map(ep => {
          const stats = getEpisodeStats(ep.tasks)
          const activeAssignees = getActiveAssignees(ep.tasks, allUsers)
          const statusColor = getEpisodeStatusColor(ep.tasks)
          const daysUntilRelease = differenceInDays(parseISO(ep.release_date), new Date())

          return (
            <Link
              key={ep.id}
              href={`/episodes/${ep.id}`}
              className="block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-600 transition-all hover:shadow-md group"
            >
              <div className="p-4">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{ep.client_label}</span>
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{ep.guest_name}</h3>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
                </div>

                {/* Progress bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span>{stats.approved}/{stats.total} tasks done</span>
                    <span>{stats.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                    <div
                      className="bg-green-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${stats.progress}%` }}
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span className={daysUntilRelease < 3 ? 'text-red-500' : ''}>
                        {daysUntilRelease < 0 ? `${Math.abs(daysUntilRelease)}d ago` :
                         daysUntilRelease === 0 ? 'Today' :
                         `${daysUntilRelease}d left`}
                      </span>
                    </div>
                    {stats.overdue > 0 && (
                      <div className="flex items-center gap-1 text-red-500">
                        <AlertCircle className="w-3 h-3" />
                        <span>{stats.overdue} overdue</span>
                      </div>
                    )}
                  </div>

                  {/* Active assignee avatars */}
                  <div className="flex -space-x-1.5">
                    {activeAssignees.slice(0, 4).map(u => (
                      <Avatar key={u.id} name={u.name} color={u.avatar_color} size="sm" />
                    ))}
                    {activeAssignees.length > 4 && (
                      <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-400 border-2 border-white dark:border-gray-900">
                        +{activeAssignees.length - 4}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {filteredEpisodes.length === 0 && (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <p className="font-medium">No episodes found</p>
          <p className="text-sm mt-1">
            {filter !== 'all' ? 'Try changing the filter' : 'Create your first episode to get started'}
          </p>
        </div>
      )}
    </div>
  )
}

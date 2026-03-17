'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, AlertCircle, ChevronRight, Calendar } from 'lucide-react'
import { Episode, Task, User, TaskStatus } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { cn, isOverdue } from '@/lib/utils'
import { parseISO, differenceInDays } from 'date-fns'

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
    tasks.filter(t => !['locked', 'approved', 'done'].includes(t.status)).map(t => t.assignee_id)
  )
  return allUsers.filter(u => assigneeIds.has(u.id))
}

function getStatusDot(tasks: Task[]): string {
  if (tasks.some(t => t.status === 'in_review')) return 'bg-purple-500'
  if (tasks.some(t => t.status === 'revision')) return 'bg-[#ff3c00]'
  if (tasks.some(t => isOverdue(t.due_date, t.status))) return 'bg-[#ff3c00]'
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
          <h1 className="text-3xl font-black text-white">Production Board</h1>
          <p className="text-[#888] text-base mt-1">{episodes.length} episode{episodes.length !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/episodes/new"
          className="flex items-center gap-2 px-4 py-2 bg-[#ff3c00] hover:bg-[#e63600] text-white rounded-lg text-base font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Episode
        </Link>
      </div>

      <div className="flex gap-2">
        {(['all', 'active', 'overdue'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize',
              filter === f
                ? 'bg-[#ff3c00] text-white'
                : 'bg-[#1e1e1e] text-[#888] border border-[#2e2e2e] hover:text-white hover:bg-[#2a2a2a]'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
        {filteredEpisodes.map(ep => {
          const stats = getEpisodeStats(ep.tasks)
          const activeAssignees = getActiveAssignees(ep.tasks, allUsers)
          const dotColor = getStatusDot(ep.tasks)
          const daysUntilRelease = differenceInDays(parseISO(ep.release_date), new Date())

          return (
            <Link
              key={ep.id}
              href={`/episodes/${ep.id}`}
              className="block bg-[#1e1e1e] border border-[#2e2e2e] rounded-2xl hover:border-[#444] transition-all hover:shadow-lg group"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                      <span className="text-base text-[#888] font-medium">{ep.client_label}</span>
                    </div>
                    <h3 className="font-black text-white text-2xl truncate">{ep.guest_name}</h3>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#555] shrink-0 group-hover:text-white transition-colors mt-1" />
                </div>

                <div className="mb-5">
                  <div className="flex justify-between text-base text-[#888] mb-1.5">
                    <span>{stats.approved}/{stats.total} tasks done</span>
                    <span>{stats.progress}%</span>
                  </div>
                  <div className="w-full bg-[#2a2a2a] rounded-full h-2">
                    <div className="bg-[#ff3c00] h-2 rounded-full transition-all" style={{ width: `${stats.progress}%` }} />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-base text-[#888]">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      <span className={daysUntilRelease < 3 ? 'text-[#ff3c00]' : ''}>
                        {daysUntilRelease < 0 ? `${Math.abs(daysUntilRelease)}d ago` :
                         daysUntilRelease === 0 ? 'Today' : `${daysUntilRelease}d left`}
                      </span>
                    </div>
                    {stats.overdue > 0 && (
                      <div className="flex items-center gap-1.5 text-[#ff3c00]">
                        <AlertCircle className="w-4 h-4" />
                        <span>{stats.overdue} overdue</span>
                      </div>
                    )}
                  </div>

                  <div className="flex -space-x-2">
                    {activeAssignees.slice(0, 4).map(u => (
                      <Avatar key={u.id} name={u.name} color={u.avatar_color} size="md" />
                    ))}
                    {activeAssignees.length > 4 && (
                      <div className="w-8 h-8 rounded-full bg-[#2a2a2a] flex items-center justify-center text-sm font-medium text-[#888] border-2 border-[#1e1e1e]">
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
        <div className="text-center py-16 text-[#555]">
          <p className="font-bold text-white text-lg">No episodes found</p>
          <p className="text-base mt-1">{filter !== 'all' ? 'Try changing the filter' : 'Create your first episode to get started'}</p>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, AlertCircle, ChevronRight, Mic } from 'lucide-react'
import { Episode, Task, User, TaskStatus } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { cn, isOverdue } from '@/lib/utils'
import { parseISO, differenceInDays, format } from 'date-fns'

interface Props {
  currentUser: User
  episodes: Episode[]
  tasks: Task[]
  allUsers: User[]
}

function getEpisodeStats(tasks: Task[]) {
  const total = tasks.length
  const done = tasks.filter(t => t.status === 'approved' || t.status === 'done').length
  const remaining = tasks.filter(t => !['approved', 'done', 'locked'].includes(t.status)).length
  const blocked = tasks.filter(t => t.status === 'locked').length
  const overdue = tasks.filter(t => isOverdue(t.due_date, t.status)).length
  const inProgress = tasks.filter(t => ['in_progress', 'in_review', 'ready', 'revision'].includes(t.status)).length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0
  return { total, done, remaining, blocked, overdue, inProgress, progress }
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

function getActiveStatus(tasks: Task[]): string | null {
  if (tasks.some(t => t.status === 'revision')) return 'Revision'
  if (tasks.some(t => t.status === 'in_review')) return 'In Review'
  if (tasks.some(t => t.status === 'in_progress')) return 'In Progress'
  if (tasks.some(t => t.status === 'ready')) return 'Ready'
  if (tasks.every(t => t.status === 'approved' || t.status === 'done')) return 'Complete'
  return null
}

function DeadlineChip({ daysLeft }: { daysLeft: number }) {
  if (daysLeft < 0) {
    return (
      <span className="px-2 py-0.5 rounded-md text-sm font-semibold bg-[#ff3c00]/20 text-[#ff3c00]">
        {Math.abs(daysLeft)}d overdue
      </span>
    )
  }
  if (daysLeft === 0) {
    return <span className="px-2 py-0.5 rounded-md text-sm font-semibold bg-[#ff3c00]/20 text-[#ff3c00]">Today</span>
  }
  if (daysLeft <= 3) {
    return <span className="px-2 py-0.5 rounded-md text-sm font-semibold bg-amber-500/20 text-amber-400">{daysLeft}d left</span>
  }
  return <span className="px-2 py-0.5 rounded-md text-sm font-semibold bg-[#2a2a2a] text-[#888]">{daysLeft}d left</span>
}

export function BoardClient({ currentUser, episodes, tasks, allUsers }: Props) {
  const [filter, setFilter] = useState<'all' | 'active' | 'overdue'>('all')

  const episodesWithTasks = episodes.map(ep => ({
    ...ep,
    tasks: tasks.filter(t => t.episode_id === ep.id),
  }))

  // Summary bar stats
  const totalOverdue = tasks.filter(t => isOverdue(t.due_date, t.status)).length
  const avgProgress = episodes.length > 0
    ? Math.round(episodesWithTasks.reduce((sum, ep) => sum + getEpisodeStats(ep.tasks).progress, 0) / episodes.length)
    : 0
  const nextDeadline = episodes
    .map(ep => differenceInDays(parseISO(ep.release_date), new Date()))
    .filter(d => d >= 0)
    .sort((a, b) => a - b)[0]
  const activeCount = episodesWithTasks.filter(ep =>
    ep.tasks.some(t => ['ready', 'in_progress', 'in_review', 'revision'].includes(t.status))
  ).length

  const filteredEpisodes = episodesWithTasks.filter(ep => {
    const stats = getEpisodeStats(ep.tasks)
    if (filter === 'active') return stats.inProgress > 0 || ep.tasks.some(t => t.status === 'ready')
    if (filter === 'overdue') return stats.overdue > 0
    return true
  })

  const filterCounts = {
    all: episodesWithTasks.length,
    active: episodesWithTasks.filter(ep => getEpisodeStats(ep.tasks).inProgress > 0 || ep.tasks.some(t => t.status === 'ready')).length,
    overdue: episodesWithTasks.filter(ep => getEpisodeStats(ep.tasks).overdue > 0).length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Production Board</h1>
          <p className="text-[#888] text-base mt-1">{episodes.length} episode{episodes.length !== 1 ? 's' : ''}</p>
        </div>
        {currentUser.role === 'admin' && (
          <Link
            href="/episodes/new"
            className="flex items-center gap-2 px-5 py-2.5 bg-[#ff3c00] hover:bg-[#e63600] text-white rounded-lg text-base font-semibold transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Project
          </Link>
        )}
      </div>

      {/* Summary bar */}
      {episodes.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Active', value: activeCount, color: 'text-white' },
            { label: 'Overdue', value: totalOverdue, color: totalOverdue > 0 ? 'text-[#ff3c00]' : 'text-white' },
            { label: 'Avg progress', value: `${avgProgress}%`, color: 'text-white' },
            { label: 'Next deadline', value: nextDeadline !== undefined ? `${nextDeadline}d` : '—', color: nextDeadline !== undefined && nextDeadline <= 3 ? 'text-amber-400' : 'text-white' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-[#1e1e1e] border border-[#2e2e2e] rounded-xl p-4">
              <p className={`text-3xl font-black ${color}`}>{value}</p>
              <p className="text-sm text-[#888] mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs with counts */}
      <div className="flex gap-2">
        {(['all', 'active', 'overdue'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 rounded-lg text-base font-medium transition-colors capitalize',
              filter === f
                ? 'bg-[#ff3c00] text-white'
                : 'bg-[#1e1e1e] text-[#888] border border-[#2e2e2e] hover:text-white hover:bg-[#2a2a2a]'
            )}
          >
            {f}
            <span className={cn(
              'text-xs font-bold px-1.5 py-0.5 rounded-full',
              filter === f ? 'bg-white/20 text-white' : 'bg-[#2a2a2a] text-[#666]'
            )}>
              {filterCounts[f]}
            </span>
          </button>
        ))}
      </div>

      {/* Episode cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
        {filteredEpisodes.map(ep => {
          const stats = getEpisodeStats(ep.tasks)
          const activeAssignees = getActiveAssignees(ep.tasks, allUsers)
          const dotColor = getStatusDot(ep.tasks)
          const activeStatus = getActiveStatus(ep.tasks)
          const daysUntilRelease = differenceInDays(parseISO(ep.release_date), new Date())

          return (
            <Link
              key={ep.id}
              href={`/episodes/${ep.id}`}
              className="block bg-[#1e1e1e] border border-[#2e2e2e] rounded-2xl hover:border-[#444] transition-all hover:shadow-lg group overflow-hidden"
            >
              <div className="p-6">
                {/* Card header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                      <span className="text-base text-[#888] font-medium">{ep.client_label}</span>
                    </div>
                    <h3 className="font-black text-white text-2xl truncate">{ep.guest_name}</h3>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#555] shrink-0 group-hover:text-white transition-colors mt-1" />
                </div>

                {/* Progress */}
                <div className="mb-2">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-base text-[#888]">{stats.done} / {stats.total} tasks</span>
                    <DeadlineChip daysLeft={daysUntilRelease} />
                  </div>
                  <div className="w-full bg-[#2a2a2a] rounded-full h-2.5">
                    <div className="bg-[#ff3c00] h-2.5 rounded-full transition-all" style={{ width: `${stats.progress}%` }} />
                  </div>
                </div>

                {/* Status badge */}
                {activeStatus && (
                  <div className="mb-4">
                    <span className="text-sm font-medium text-[#888] bg-[#2a2a2a] px-2.5 py-1 rounded-md">
                      {activeStatus}
                    </span>
                  </div>
                )}

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 mb-4 pt-3 border-t border-[#2a2a2a]">
                  <div className="text-center">
                    <p className={`text-xl font-black ${stats.done > 0 ? 'text-green-400' : 'text-[#555]'}`}>{stats.done}</p>
                    <p className="text-xs text-[#666] mt-0.5">Done</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-black text-white">{stats.remaining}</p>
                    <p className="text-xs text-[#666] mt-0.5">Remaining</p>
                  </div>
                  <div className="text-center">
                    <p className={`text-xl font-black ${stats.blocked > 0 ? 'text-amber-400' : 'text-[#555]'}`}>{stats.blocked}</p>
                    <p className="text-xs text-[#666] mt-0.5">Blocked</p>
                  </div>
                </div>

                {/* Assignees */}
                <div className="flex items-center justify-between">
                  {stats.overdue > 0 && (
                    <div className="flex items-center gap-1.5 text-sm text-[#ff3c00]">
                      <AlertCircle className="w-4 h-4" />
                      <span>{stats.overdue} overdue</span>
                    </div>
                  )}
                  <div className="flex -space-x-2 ml-auto">
                    {activeAssignees.slice(0, 5).map(u => (
                      <Avatar key={u.id} name={u.name} color={u.avatar_color} size="md" />
                    ))}
                    {activeAssignees.length > 5 && (
                      <div className="w-8 h-8 rounded-full bg-[#2a2a2a] flex items-center justify-center text-sm font-medium text-[#888] border-2 border-[#1e1e1e]">
                        +{activeAssignees.length - 5}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Empty state */}
      {filteredEpisodes.length === 0 && (
        <div className="border-2 border-dashed border-[#2e2e2e] rounded-2xl py-20 text-center">
          <div className="text-5xl mb-4">🎙️</div>
          <p className="text-xl font-bold text-white">
            {filter !== 'all' ? `No ${filter} episodes` : 'No episodes yet'}
          </p>
          <p className="text-base text-[#888] mt-2">
            {filter !== 'all'
              ? 'Try switching to All'
              : 'Hit "+ New Project" to kick off your next production'}
          </p>
          {filter === 'all' && (
            <Link
              href="/episodes/new"
              className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-[#ff3c00] hover:bg-[#e63600] text-white rounded-lg text-base font-semibold transition-colors"
            >
              <Plus className="w-5 h-5" />
              New Project
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

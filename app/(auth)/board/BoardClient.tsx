'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, AlertCircle, ChevronRight, Archive, ExternalLink } from 'lucide-react'
import { Episode, Task, User, TaskStatus, canCreateProject, canManageClients } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { cn, isOverdue, formatDate } from '@/lib/utils'
import { parseISO, differenceInDays, differenceInHours, format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'

interface Props {
  currentUser: User
  episodes: Episode[]
  tasks: Task[]
  allUsers: User[]
  publishedEpisodes: Episode[]
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

function getActivePipelineStage(tasks: Task[]): string | null {
  const activeTasks = tasks.filter(t => t.status === 'ready' || t.status === 'in_progress')
  if (activeTasks.length === 0) return null
  const counts: Record<string, number> = {}
  for (const t of activeTasks) counts[t.track] = (counts[t.track] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
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
      <span className="px-3 py-1 rounded-lg text-base font-bold bg-[#ff3c00]/20 text-[#ff3c00]">
        {Math.abs(daysLeft)}d overdue
      </span>
    )
  }
  if (daysLeft === 0) {
    return <span className="px-3 py-1 rounded-lg text-base font-bold bg-[#ff3c00]/20 text-[#ff3c00]">Today</span>
  }
  if (daysLeft <= 3) {
    return <span className="px-3 py-1 rounded-lg text-base font-bold bg-amber-500/20 text-amber-400">{daysLeft}d left</span>
  }
  return <span className="px-3 py-1 rounded-lg text-base font-bold bg-[#1e1e1e] text-[#888]">{daysLeft}d left</span>
}

export function BoardClient({ currentUser, episodes, tasks, allUsers, publishedEpisodes: initialPublished }: Props) {
  const [filter, setFilter] = useState<'all' | 'active' | 'overdue' | 'archive'>('all')
  const [published, setPublished] = useState<Episode[]>(initialPublished)
  const supabase = createClient()

  async function togglePublish(episodeId: string, publish: boolean) {
    await supabase.from('episodes').update({ published_at: publish ? new Date().toISOString() : null }).eq('id', episodeId)
    if (publish) {
      const ep = episodes.find(e => e.id === episodeId)
      if (ep) setPublished(prev => [{ ...ep, published_at: new Date().toISOString() }, ...prev])
    } else {
      setPublished(prev => prev.filter(e => e.id !== episodeId))
    }
  }

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
        {canCreateProject(currentUser) && (
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
            <div key={label} className="bg-[#141414] border border-[#2e2e2e] rounded-xl p-4">
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
                : 'bg-[#141414] text-[#888] border border-[#2e2e2e] hover:text-white hover:bg-[#1e1e1e]'
            )}
          >
            {f}
            <span className={cn(
              'text-xs font-bold px-1.5 py-0.5 rounded-full',
              filter === f ? 'bg-white/20 text-white' : 'bg-[#1e1e1e] text-[#666]'
            )}>
              {filterCounts[f]}
            </span>
          </button>
        ))}
        <button
          onClick={() => setFilter('archive')}
          className={cn(
            'flex items-center gap-2 px-4 py-1.5 rounded-lg text-base font-medium transition-colors ml-auto',
            filter === 'archive'
              ? 'bg-[#ff3c00] text-white'
              : 'bg-[#141414] text-[#888] border border-[#2e2e2e] hover:text-white hover:bg-[#1e1e1e]'
          )}
        >
          <Archive className="w-4 h-4" />
          Archive
          <span className={cn(
            'text-xs font-bold px-1.5 py-0.5 rounded-full',
            filter === 'archive' ? 'bg-white/20 text-white' : 'bg-[#1e1e1e] text-[#666]'
          )}>
            {published.length}
          </span>
        </button>
      </div>

      {/* Archive tab */}
      {filter === 'archive' && (
        <ArchiveTab
          activeEpisodes={episodes}
          publishedEpisodes={published}
          currentUser={currentUser}
          onTogglePublish={togglePublish}
        />
      )}

      {/* Episode cards */}
      {filter !== 'archive' && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
        {filteredEpisodes.map(ep => {
          const stats = getEpisodeStats(ep.tasks)
          const activeAssignees = getActiveAssignees(ep.tasks, allUsers)
          const dotColor = getStatusDot(ep.tasks)
          const activePipelineStage = stats.done === 0 ? getActivePipelineStage(ep.tasks) : null
          const daysUntilRelease = differenceInDays(parseISO(ep.release_date), new Date())
          const hoursUntilRelease = differenceInHours(parseISO(ep.release_date), new Date())
          const isReleaseOverdue = hoursUntilRelease < 0
          const isReleaseSoon = !isReleaseOverdue && hoursUntilRelease <= 24

          return (
            <Link
              key={ep.id}
              href={`/episodes/${ep.id}`}
              className={cn(
                'block bg-[#141414] rounded-2xl transition-all hover:shadow-lg group overflow-hidden border',
                isReleaseOverdue
                  ? 'border-[#ff3c00]/50 shadow-[0_0_14px_rgba(255,60,0,0.2)]'
                  : isReleaseSoon
                  ? 'border-yellow-500/50 shadow-[0_0_14px_rgba(234,179,8,0.2)]'
                  : 'border-[#2e2e2e] hover:border-[#444]'
              )}
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
                  <div className="flex flex-col items-end gap-2 shrink-0 ml-2">
                    <DeadlineChip daysLeft={daysUntilRelease} />
                    <ChevronRight className="w-5 h-5 text-[#555] group-hover:text-white transition-colors" />
                  </div>
                </div>

                {/* Progress */}
                <div className="mb-4">
                  {stats.done > 0 ? (
                    <>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-base text-[#888]">{stats.done} / {stats.total} tasks</span>
                      </div>
                      <div className="w-full bg-[#1e1e1e] rounded-full h-2.5">
                        <div className="bg-[#ff3c00] h-2.5 rounded-full transition-all" style={{ width: `${stats.progress}%` }} />
                      </div>
                    </>
                  ) : activePipelineStage ? (
                    <span className="inline-block text-sm font-semibold text-[#f7931a]/80 bg-[#f7931a]/10 px-3 py-1 rounded-full">
                      {activePipelineStage} in progress
                    </span>
                  ) : (
                    <span className="text-sm text-[#555]">Not started</span>
                  )}
                </div>


                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 mb-4 pt-3 border-t border-[#1e1e1e]">
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
                    <p className="text-xs text-[#666] mt-0.5">Queued</p>
                  </div>
                </div>

                {/* Spawned-from badge — only on non-default spawned episodes */}
                {ep.source_episode_id && ep.source?.guest_name && ep.template_name && ep.template_name !== 'Default' && (
                  <Link
                    href={`/episodes/${ep.source.id}`}
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1.5 text-xs text-[#f7931a]/70 hover:text-[#f7931a] transition-colors mb-3"
                  >
                    <span className="text-[10px]">↗</span>
                    <span>From: {ep.source.template_name ?? 'Default'} — {ep.source.guest_name}</span>
                  </Link>
                )}

                {/* Notes preview */}
                {ep.notes && (
                  <p className="text-xs text-[#666] leading-relaxed mb-3 line-clamp-2">{ep.notes}</p>
                )}

                {/* Assignees */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {stats.overdue > 0 && (
                      <div className="flex items-center gap-1.5 text-sm text-[#ff3c00]">
                        <AlertCircle className="w-4 h-4" />
                        <span>{stats.overdue} overdue</span>
                      </div>
                    )}
                    {ep.footage_url && (
                      <a
                        href={ep.footage_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs font-semibold text-[#f7931a]/80 hover:text-[#f7931a] transition-colors"
                      >
                        Footage →
                      </a>
                    )}
                  </div>
                  <div className="flex -space-x-2 ml-auto">
                    {activeAssignees.slice(0, 5).map(u => (
                      <Avatar key={u.id} name={u.name} color={u.avatar_color} size="md" />
                    ))}
                    {activeAssignees.length > 5 && (
                      <div className="w-8 h-8 rounded-full bg-[#1e1e1e] flex items-center justify-center text-sm font-medium text-[#888] border-2 border-[#141414]">
                        +{activeAssignees.length - 5}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>}

      {/* Empty state */}
      {filter !== 'archive' && filteredEpisodes.length === 0 && (
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
          {filter === 'all' && canCreateProject(currentUser) && (
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

function ArchiveTab({ activeEpisodes, publishedEpisodes, currentUser, onTogglePublish }: {
  activeEpisodes: Episode[]
  publishedEpisodes: Episode[]
  currentUser: User
  onTogglePublish: (id: string, publish: boolean) => void
}) {
  const canPublish = canManageClients(currentUser)

  return (
    <div className="space-y-6">
      {/* Active — can be marked published */}
      {canPublish && activeEpisodes.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#555] uppercase tracking-wide mb-2">Active — mark as published to archive</p>
          <div className="border border-[#2e2e2e] rounded-xl overflow-hidden divide-y divide-[#242424]">
            {activeEpisodes.map(ep => (
              <div key={ep.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#111111] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{ep.guest_name}</p>
                  <p className="text-xs text-[#666]">{ep.client_label} · Releases {formatDate(ep.release_date)}</p>
                </div>
                <a href={`/episodes/${ep.id}`} className="p-1.5 rounded hover:bg-[#1e1e1e] text-[#555] hover:text-white transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={() => onTogglePublish(ep.id, true)}
                  className="px-3 py-1.5 text-xs font-semibold text-[#888] border border-[#2e2e2e] rounded-lg hover:border-green-500/50 hover:text-green-400 transition-colors"
                >
                  Mark Published
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Published / archived */}
      {publishedEpisodes.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-[#555] uppercase tracking-wide mb-2">Published — {publishedEpisodes.length}</p>
          <div className="border border-[#2e2e2e] rounded-xl overflow-hidden divide-y divide-[#242424]">
            {publishedEpisodes.map(ep => (
              <div key={ep.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#111111] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{ep.guest_name}</p>
                  <p className="text-xs text-[#666]">{ep.client_label} · Published {ep.published_at ? formatDate(ep.published_at) : ''}</p>
                </div>
                <a href={`/episodes/${ep.id}`} className="p-1.5 rounded hover:bg-[#1e1e1e] text-[#555] hover:text-white transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {canPublish && (
                  <button
                    onClick={() => onTogglePublish(ep.id, false)}
                    className="px-3 py-1.5 text-xs font-semibold text-[#555] border border-[#1e1e1e] rounded-lg hover:border-[#ff3c00]/50 hover:text-[#ff3c00] transition-colors"
                  >
                    Unarchive
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-16 text-[#555]">
          <Archive className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-bold text-white">Nothing archived yet</p>
          <p className="text-sm mt-1">Mark episodes as published to move them here</p>
        </div>
      )}
    </div>
  )
}

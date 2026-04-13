'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, AlertCircle, ChevronRight, Archive, ExternalLink, MoreHorizontal, Trash2, Search, X, Check } from 'lucide-react'
import { InfoIcon } from '@/components/ui/InfoIcon'
import { Episode, Task, User, TaskStatus, canCreateProject, canManageClients, canSeeAllEpisodes } from '@/lib/types'
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
  memberFilterId?: string | null
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

function CompletionCircle({ filling, filled }: { filling: boolean; filled: boolean }) {
  const r = 10
  const circ = 2 * Math.PI * r
  const [dashOffset, setDashOffset] = useState(circ)
  const [showCheck, setShowCheck] = useState(false)

  useEffect(() => {
    if (filling) {
      setShowCheck(false)
      setDashOffset(circ)
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setDashOffset(0)))
      const checkTimer = setTimeout(() => setShowCheck(true), 400)
      return () => { cancelAnimationFrame(id); clearTimeout(checkTimer) }
    }
  }, [filling])

  useEffect(() => {
    if (filled) { setDashOffset(0); setShowCheck(true) }
    else if (!filling) { setDashOffset(circ); setShowCheck(false) }
  }, [filled])

  const isActive = filling || filled
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" style={{ display: 'block' }}>
      <circle cx="14" cy="14" r={r} fill={filled ? '#f7931a' : 'transparent'} style={{ transition: 'fill 150ms' }} />
      <circle cx="14" cy="14" r={r} fill="transparent"
        stroke={isActive ? '#f7931a' : 'rgba(255,255,255,0.25)'}
        strokeWidth="2"
        style={{ transition: 'stroke 200ms' }}
      />
      <circle cx="14" cy="14" r={r} fill="transparent"
        stroke="#f7931a" strokeWidth="2.5"
        strokeDasharray={`${circ} ${circ}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{
          transform: 'rotate(-90deg)',
          transformOrigin: '14px 14px',
          transition: filling ? 'stroke-dashoffset 600ms ease-in-out' : 'none',
          opacity: filling && !filled ? 1 : 0,
        }}
      />
      {showCheck && (
        <path d="M9 14.5l3 3 7-7" stroke={filled ? '#000' : '#f7931a'}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
        />
      )}
    </svg>
  )
}

export function BoardClient({ currentUser, episodes, tasks, allUsers, publishedEpisodes: initialPublished, memberFilterId }: Props) {
  const [filter, setFilter] = useState<'all' | 'active' | 'overdue' | 'archive'>('all')
  const [published, setPublished] = useState<Episode[]>(initialPublished)
  const [liveEpisodes, setLiveEpisodes] = useState<Episode[]>(episodes)
  const [liveTasks, setLiveTasks] = useState<Task[]>(tasks)
  // Circle completion animation state
  const [circleCompletingId, setCircleCompletingId] = useState<string | null>(null)
  const [circleCompletedIds, setCircleCompletedIds] = useState<Set<string>>(new Set())
  const [circleFadingIds, setCircleFadingIds] = useState<Set<string>>(new Set())
  const [circleArchivedIds, setCircleArchivedIds] = useState<Set<string>>(new Set())
  const [circleWarningId, setCircleWarningId] = useState<string | null>(null)
  const [circleUndoInfo, setCircleUndoInfo] = useState<{
    id: string
    guestName: string
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const supabase = createClient()
  const router = useRouter()

  // Realtime: episode inserts, updates (archive/restore), deletes
  useEffect(() => {
    const channel = supabase
      .channel('board-episodes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'episodes' }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          if (!canSeeAllEpisodes(currentUser)) return
          const { data } = await supabase
            .from('episodes')
            .select('*, source:episodes!source_episode_id(id, guest_name, template_name)')
            .eq('id', payload.new.id)
            .single()
          if (data && !(data as unknown as Episode).published_at) {
            setLiveEpisodes(prev =>
              [...prev, data as unknown as Episode]
                .sort((a, b) => new Date(a.release_date).getTime() - new Date(b.release_date).getTime())
            )
          }
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new as Episode
          if (updated.published_at) {
            // Episode archived → remove from board, add to archive list
            setLiveEpisodes(prev => prev.filter(e => e.id !== updated.id))
            setPublished(prev => prev.some(e => e.id === updated.id) ? prev : [updated, ...prev])
          } else {
            // Episode updated or restored from archive
            setLiveEpisodes(prev => {
              if (prev.some(e => e.id === updated.id)) {
                return prev.map(e => e.id === updated.id ? { ...e, ...updated } : e)
              }
              return [...prev, updated].sort((a, b) => new Date(a.release_date).getTime() - new Date(b.release_date).getTime())
            })
            setPublished(prev => prev.filter(e => e.id !== updated.id))
          }
        } else if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as { id: string }).id
          setLiveEpisodes(prev => prev.filter(e => e.id !== deletedId))
          setPublished(prev => prev.filter(e => e.id !== deletedId))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser.id])

  // Realtime: task updates → live episode card counts
  useEffect(() => {
    const channel = supabase
      .channel('board-tasks')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, (payload) => {
        setLiveTasks(prev => prev.map(t => t.id === payload.new.id ? { ...t, ...payload.new } : t))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, async (payload) => {
        const newTask = payload.new as Task
        if (!canSeeAllEpisodes(currentUser) && newTask.assignee_id !== currentUser.id) return
        const { data } = await supabase
          .from('tasks')
          .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*)')
          .eq('id', newTask.id)
          .single()
        if (data) setLiveTasks(prev => [...prev, data as unknown as Task])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser.id])

  const memberFilter = memberFilterId ? allUsers.find(u => u.id === memberFilterId) ?? null : null
  const canAct = canManageClients(currentUser)

  async function togglePublish(episodeId: string, publish: boolean): Promise<boolean> {
    const now = new Date().toISOString()
    if (publish) {
      const ep = liveEpisodes.find(e => e.id === episodeId)
      const { error } = await supabase.from('episodes').update({
        published_at: now,
        archived: true,
        completed_at: now,
        restored_at: null,
      }).eq('id', episodeId)
      if (error) {
        console.error('[togglePublish] failed:', error)
        return false
      }
      // Hard-remove from live board immediately — don't rely solely on circleArchivedIds
      setLiveEpisodes(prev => prev.filter(e => e.id !== episodeId))
      if (ep) setPublished(prev => [{ ...ep, published_at: now, archived: true, completed_at: now, restored_at: null }, ...prev])
      return true
    } else {
      const ep = published.find(e => e.id === episodeId)
      const newRestoreCount = (ep?.restore_count ?? 0) + 1
      const { error } = await supabase.from('episodes').update({
        published_at: null,
        archived: false,
        completed_at: null,
        restored_at: now,
        restore_count: newRestoreCount,
      }).eq('id', episodeId)
      if (error) { console.error('[togglePublish] restore failed:', error); return false }
      setPublished(prev => prev.filter(e => e.id !== episodeId))
      return true
    }
  }

  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

  async function handleCircleComplete(ep: { id: string; guest_name: string; tasks: Task[] }) {
    if (circleCompletingId === ep.id || circleCompletedIds.has(ep.id) || circleFadingIds.has(ep.id) || circleArchivedIds.has(ep.id)) return

    const incompleteTasks = ep.tasks.filter(t => !['done', 'approved'].includes(t.status))
    if (incompleteTasks.length > 0) {
      setCircleWarningId(ep.id)
      await sleep(800)
      setCircleWarningId(null)
    }

    // DB write happens immediately — before the rest of the animation
    const ok = await togglePublish(ep.id, true)
    if (!ok) return

    // Set up undo toast
    if (circleUndoInfo?.timer) clearTimeout(circleUndoInfo.timer)
    const undoTimer = setTimeout(() => setCircleUndoInfo(null), 5000)
    setCircleUndoInfo({ id: ep.id, guestName: ep.guest_name, timer: undoTimer })

    // Animation only — data is already saved
    setCircleCompletingId(ep.id)
    await sleep(600)
    setCircleCompletingId(null)
    setCircleCompletedIds(prev => new Set([...prev, ep.id]))
    await sleep(3000)
    setCircleCompletedIds(prev => { const n = new Set(prev); n.delete(ep.id); return n })
    setCircleFadingIds(prev => new Set([...prev, ep.id]))
    await sleep(300)
    setCircleFadingIds(prev => { const n = new Set(prev); n.delete(ep.id); return n })
    setCircleArchivedIds(prev => new Set([...prev, ep.id]))
  }

  async function handleUndoComplete() {
    if (!circleUndoInfo) return
    clearTimeout(circleUndoInfo.timer)
    const { id } = circleUndoInfo
    await supabase.from('episodes').update({ published_at: null, archived: false, completed_at: null }).eq('id', id)
    setPublished(prev => prev.filter(e => e.id !== id))
    setCircleArchivedIds(prev => { const n = new Set(prev); n.delete(id); return n })
    setCircleUndoInfo(null)
  }

  const episodesWithTasks = liveEpisodes
    .filter(ep => !circleArchivedIds.has(ep.id))
    .map(ep => ({
      ...ep,
      tasks: liveTasks.filter(t => t.episode_id === ep.id),
    }))

  // Summary bar stats
  const now = new Date()
  const activeCount = episodesWithTasks.filter(ep =>
    ep.tasks.some(t => ['ready', 'in_progress', 'in_review', 'revision'].includes(t.status))
  ).length
  const overdueEpisodeCount = episodesWithTasks.filter(ep => parseISO(ep.release_date) < now).length
  const notStartedCount = episodesWithTasks.filter(ep =>
    !ep.tasks.some(t => t.status === 'done' || t.status === 'approved')
  ).length
  const nextEpisode = episodesWithTasks
    .filter(ep => parseISO(ep.release_date) >= now)
    .sort((a, b) => parseISO(a.release_date).getTime() - parseISO(b.release_date).getTime())[0] ?? null
  function formatNextDeadlineLabel(ep: typeof nextEpisode): string {
    if (!ep) return '—'
    const days = differenceInDays(parseISO(ep.release_date), now)
    if (days === 0) return 'Today'
    if (days === 1) return 'Tomorrow'
    return format(parseISO(ep.release_date), 'MMM d')
  }

  const filteredEpisodes = episodesWithTasks.filter(ep => {
    // Member filter: only episodes where this user has at least one task
    if (memberFilter && !ep.tasks.some(t => t.assignee_id === memberFilter.id)) return false
    const stats = getEpisodeStats(ep.tasks)
    if (filter === 'active') {
      if (!(stats.inProgress > 0 || ep.tasks.some(t => t.status === 'ready'))) return false
    }
    if (filter === 'overdue') {
      if (stats.overdue === 0) return false
    }
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
          <h1 className="text-[26px] font-bold text-white">Production Board</h1>
          <p className="text-[#888] text-[15px] mt-1">{liveEpisodes.length} episode{liveEpisodes.length !== 1 ? 's' : ''}</p>
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

      {/* Active member filter chip */}
      {memberFilter && (
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#666]">Filtered by</span>
          <div className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-full" style={{ background: '#1e1e1e', border: '1px solid rgba(247,147,26,0.4)' }}>
            <div
              className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: memberFilter.avatar_color || '#444' }}
            >
              {memberFilter.name[0].toUpperCase()}
            </div>
            <span className="text-[13px] font-semibold text-white">{memberFilter.name}&apos;s tasks</span>
            <button
              onClick={() => router.replace('/board')}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[#666] hover:text-white hover:bg-white/10 transition-colors text-sm font-bold ml-0.5"
              aria-label="Clear member filter"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Summary bar */}
      {liveEpisodes.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {/* Active */}
          <div className="rounded-xl p-4" style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="text-3xl font-black text-white">{activeCount}</p>
            <p className="text-sm text-[#888] mt-1">Active</p>
          </div>
          {/* Overdue episodes */}
          <div className="rounded-xl p-4" style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)' }}>
            <p className={`text-3xl font-black ${overdueEpisodeCount > 0 ? 'text-[#dc2626]' : 'text-white'}`}>{overdueEpisodeCount}</p>
            <p className="text-sm text-[#888] mt-1">Overdue episodes</p>
          </div>
          {/* Not started */}
          <div className="rounded-xl p-4" style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="text-3xl font-black text-white">{notStartedCount}</p>
            <p className="text-sm text-[#888] mt-1 flex items-center gap-1.5">
              Not started
              <InfoIcon text="Episodes where no tasks have been completed or approved yet. These projects have not had any production work begin." />
            </p>
          </div>
          {/* Next deadline */}
          {nextEpisode ? (
            <button
              onClick={() => router.push(`/episodes/${nextEpisode.id}`)}
              className="rounded-xl p-4 text-left hover:bg-[#252525] transition-colors"
              style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <p className="text-3xl font-black text-white">{formatNextDeadlineLabel(nextEpisode)}</p>
              <p className="text-sm text-[#888] mt-1">Next deadline</p>
              <p className="text-xs text-[#555] mt-0.5 truncate">{nextEpisode.guest_name} · {nextEpisode.client_label}</p>
            </button>
          ) : (
            <div className="rounded-xl p-4" style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)' }}>
              <p className="text-3xl font-black text-white">—</p>
              <p className="text-sm text-[#888] mt-1">Next deadline</p>
            </div>
          )}
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
          publishedEpisodes={published}
          currentUser={currentUser}
          onTogglePublish={togglePublish}
          onDeleteEpisodes={(ids) => setPublished(prev => prev.filter(ep => !ids.includes(ep.id)))}
        />
      )}

      {/* Episode cards */}
      {filter !== 'archive' && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4" style={{ isolation: 'isolate' }}>
        {filteredEpisodes.map(ep => {
          const stats = getEpisodeStats(ep.tasks)
          const activeAssignees = getActiveAssignees(ep.tasks, allUsers)
          const dotColor = getStatusDot(ep.tasks)
          const activePipelineStage = stats.done === 0 ? getActivePipelineStage(ep.tasks) : null
          const daysUntilRelease = differenceInDays(parseISO(ep.release_date), new Date())
          const hoursUntilRelease = differenceInHours(parseISO(ep.release_date), new Date())
          const isReleaseOverdue = hoursUntilRelease < 0
          const isReleaseSoon = !isReleaseOverdue && hoursUntilRelease <= 24

          const isCompleting = circleCompletingId === ep.id
          const isCompleted = circleCompletedIds.has(ep.id)
          const isFadingOut = circleFadingIds.has(ep.id)
          const isWarning = circleWarningId === ep.id
          const incompleteCount = ep.tasks.filter(t => !['done', 'approved'].includes(t.status)).length
          const circleActive = isCompleting || isCompleted || isFadingOut

          return (
            <div
              key={ep.id}
              onClick={() => router.push(`/episodes/${ep.id}`)}
              className={cn(
                'relative cursor-pointer rounded-2xl group overflow-hidden',
                '[will-change:transform] [transform:scale(1)] hover:[transform:scale(1.018)]',
                '[transition:transform_200ms_ease,box-shadow_200ms_ease,background_300ms,border-color_300ms]',
                'hover:[box-shadow:0_4px_24px_rgba(0,0,0,0.35)]',
                isReleaseOverdue ? 'shadow-[0_0_14px_rgba(255,60,0,0.2)]' :
                isReleaseSoon ? 'shadow-[0_0_14px_rgba(234,179,8,0.2)]' : ''
              )}
              style={{
                background: isCompleted ? '#0f1a0f' : '#1e1e1e',
                border: isCompleted
                  ? '1px solid rgba(34,197,94,0.3)'
                  : isReleaseOverdue
                  ? '1px solid rgba(255,60,0,0.5)'
                  : isReleaseSoon
                  ? '1px solid rgba(234,179,8,0.5)'
                  : '1px solid rgba(255,255,255,0.1)',
                opacity: isFadingOut ? 0 : 1,
                ...(isFadingOut && {
                  transform: 'scale(0.95)',
                  transition: 'opacity 300ms ease, transform 300ms ease',
                }),
              }}
            >
              {/* Completed overlay */}
              {isCompleted && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <span style={{ fontSize: 18, fontWeight: 600, color: '#22c55e' }}>Completed ✓</span>
                </div>
              )}

              {/* Circle completion button */}
              {canAct && (
                <div
                  className="absolute"
                  style={{ top: 12, right: 12, zIndex: 20 }}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Incomplete tasks warning badge */}
                  {isWarning && incompleteCount > 0 && (
                    <div
                      className="absolute right-8 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold text-amber-400 px-2 py-0.5 rounded"
                      style={{
                        background: 'rgba(245,158,11,0.15)',
                        border: '1px solid rgba(245,158,11,0.3)',
                        animation: 'fadeIn 150ms ease',
                      }}
                    >
                      {incompleteCount} incomplete
                    </div>
                  )}
                  <button
                    className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center transition-opacity duration-150 hover:[&:not(:disabled)]:scale-110',
                      circleActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}
                    style={{ transition: 'opacity 150ms, transform 100ms' }}
                    onClick={() => handleCircleComplete(ep)}
                    disabled={isCompleted || isCompleting || isFadingOut}
                  >
                    <CompletionCircle filling={isCompleting} filled={isCompleted || isFadingOut} />
                  </button>
                </div>
              )}

              <div
                className={cn(
                  'p-5 transition-[transform,opacity]',
                  !circleActive && canAct && 'group-hover:[transform:translateX(-10px)]'
                )}
                style={{ opacity: isCompleted ? 0.4 : 1, transitionDuration: '200ms, 300ms' }}
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                      <span className="text-base text-[#888] font-medium">{ep.client_label}</span>
                    </div>
                    <h3 className="font-bold text-white text-[22px] truncate">{ep.guest_name}</h3>
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
                  <button
                    onClick={e => { e.stopPropagation(); router.push(`/episodes/${ep.source!.id}`) }}
                    className="flex items-center gap-1.5 text-xs text-[#f7931a]/70 hover:text-[#f7931a] transition-colors mb-3"
                  >
                    <span className="text-[10px]">↗</span>
                    <span>From: {ep.source.template_name ?? 'Default'} — {ep.source.guest_name}</span>
                  </button>
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
                      <Avatar key={u.id} name={u.name} color={u.avatar_color} size="md" avatarUrl={u.avatar_url} />
                    ))}
                    {activeAssignees.length > 5 && (
                      <div className="w-8 h-8 rounded-full bg-[#1e1e1e] flex items-center justify-center text-sm font-medium text-[#888] border-2 border-[#141414]">
                        +{activeAssignees.length - 5}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
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

      {/* Circle complete undo toast */}
      {circleUndoInfo && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl"
          style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
          <p className="text-sm font-semibold text-white">{circleUndoInfo.guestName} completed and archived</p>
          <button
            onClick={handleUndoComplete}
            className="text-sm font-semibold text-[#f7931a] hover:text-[#ff9d2e] transition-colors ml-1 shrink-0"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

function ArchiveTab({ publishedEpisodes, currentUser, onTogglePublish, onDeleteEpisodes }: {
  publishedEpisodes: Episode[]
  currentUser: User
  onTogglePublish: (id: string, publish: boolean) => void
  onDeleteEpisodes: (ids: string[]) => void
}) {
  const supabase = createClient()
  const canPublish = canManageClients(currentUser)
  const canDelete = currentUser.role === 'admin'

  const [search, setSearch] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [templateFilter, setTemplateFilter] = useState('')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [singleDeleteTarget, setSingleDeleteTarget] = useState<Episode | null>(null)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  // Issue 1: fixed-position dropdown state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Issue 1: close fixed dropdown on outside click
  useEffect(() => {
    if (!openMenuId) return
    const close = () => { setOpenMenuId(null); setMenuPos(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  // Issue 1: open menu with fixed-position calculation
  function handleMenuOpen(epId: string, btn: HTMLElement) {
    if (openMenuId === epId) { setOpenMenuId(null); setMenuPos(null); return }
    const rect = btn.getBoundingClientRect()
    const menuHeight = (canPublish ? 1 : 0) * 40 + (canDelete ? 1 : 0) * 40 + 8
    const wouldFlip = rect.bottom + menuHeight > window.innerHeight - 8
    setMenuPos({
      top: wouldFlip ? rect.top - menuHeight : rect.bottom + 4,
      right: window.innerWidth - rect.right,
    })
    setOpenMenuId(epId)
  }

  // Derive distinct filter options
  const clientOptions = [...new Set(publishedEpisodes.map(ep => ep.client_label))].sort()
  const templateOptions = [...new Set(
    publishedEpisodes.map(ep => ep.template_name).filter(Boolean) as string[]
  )].sort()

  const hasActiveFilter = !!(clientFilter || dateFrom || dateTo || templateFilter || search.trim())

  const filteredPublished = publishedEpisodes.filter(ep => {
    if (search && !ep.guest_name.toLowerCase().includes(search.toLowerCase()) &&
        !ep.client_label.toLowerCase().includes(search.toLowerCase())) return false
    if (clientFilter && ep.client_label !== clientFilter) return false
    if (dateFrom || dateTo) {
      const epDate = ep.published_at ? ep.published_at.split('T')[0] : null
      if (!epDate) return false
      if (dateFrom && epDate < dateFrom) return false
      if (dateTo && epDate > dateTo) return false
    }
    if (templateFilter && ep.template_name !== templateFilter) return false
    return true
  })

  const totalAll = publishedEpisodes.length
  const totalVisible = filteredPublished.length
  const selectionCount = selectedIds.size
  const hasSearchFilter = search.trim() !== ''

  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(filteredPublished.map(ep => ep.id)))
  }

  function deselectAll() {
    setSelectedIds(new Set())
  }

  function exitSelectionMode() {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  async function doDelete(ids: string[]) {
    setDeleting(true)
    try {
      const res = await fetch('/api/episodes/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const data = await res.json()

      if (!res.ok) {
        console.error('[doDelete] API error:', data.error)
        setToast(`Delete failed: ${data.error || 'Unknown error'}`)
        return
      }

      // Only update local state after confirmed server-side deletion
      setFadingIds(new Set(ids))
      setTimeout(() => {
        onDeleteEpisodes(ids)
        setFadingIds(new Set())
        setToast(ids.length === 1 ? 'Episode deleted permanently' : `Deleted ${ids.length} episodes permanently`)
      }, 350)
    } catch (err) {
      console.error('[doDelete] Unexpected error:', err)
      setToast('Delete failed — please try again')
    } finally {
      setDeleting(false)
      setBulkDeleteOpen(false)
      setSingleDeleteTarget(null)
      setDeleteInput('')
      exitSelectionMode()
    }
  }

  const selectedEpisodes = publishedEpisodes.filter(ep => selectedIds.has(ep.id))

  const openMenuEp = openMenuId ? publishedEpisodes.find(ep => ep.id === openMenuId) ?? null : null

  return (
    <>
      <div className="space-y-6 pb-20">
        {/* Archive filter bar — ALWAYS rendered */}
        <div>
          <div className="flex items-center gap-3 flex-wrap mb-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#444] pointer-events-none" />
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg pl-7 pr-7 py-1.5 text-[13px] text-white placeholder-[#444] focus:outline-none focus:border-[#3a3a3a] w-40"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#555] hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Client filter */}
            {clientOptions.length > 0 && (
              <select
                value={clientFilter}
                onChange={e => setClientFilter(e.target.value)}
                className={cn(
                  'bg-[#1a1a1a] border rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-[#3a3a3a] appearance-none pr-6',
                  clientFilter ? 'border-[#f7931a]/40 text-white' : 'border-[#2a2a2a] text-[#888]'
                )}
                style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%23666\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
              >
                <option value="">All clients</option>
                {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            {/* Date range filter */}
            <div className={cn(
              'flex items-center gap-1.5 border rounded-lg px-2.5 py-1',
              (dateFrom || dateTo) ? 'border-[#f7931a]/40' : 'border-[#2a2a2a]'
            )}>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="bg-transparent text-[13px] focus:outline-none w-[112px] text-[#888] [color-scheme:dark]"
                placeholder="From"
              />
              <span className="text-[#444] text-xs">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="bg-transparent text-[13px] focus:outline-none w-[112px] text-[#888] [color-scheme:dark]"
                placeholder="To"
              />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-[#555] hover:text-white ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Template / deliverable type filter */}
            {templateOptions.length > 0 && (
              <select
                value={templateFilter}
                onChange={e => setTemplateFilter(e.target.value)}
                className={cn(
                  'bg-[#1a1a1a] border rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-[#3a3a3a] appearance-none pr-6',
                  templateFilter ? 'border-[#f7931a]/40 text-white' : 'border-[#2a2a2a] text-[#888]'
                )}
                style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%23666\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
              >
                <option value="">All types</option>
                {templateOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}

            {/* Clear filters */}
            {hasActiveFilter && (
              <button
                onClick={() => { setSearch(''); setClientFilter(''); setDateFrom(''); setDateTo(''); setTemplateFilter('') }}
                className="text-[13px] text-[#666] hover:text-white underline underline-offset-2 transition-colors"
              >
                Clear filters
              </button>
            )}

            {/* Archive count + Select button */}
            <div className="ml-auto flex items-center gap-3 shrink-0">
              <span className="text-xs font-semibold text-[#555] uppercase tracking-wide">
                Archive — {totalAll}
              </span>
              {canDelete && (
                <button
                  onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
                  className={cn(
                    'text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors',
                    selectionMode
                      ? 'text-white border-[#3a3a3a] bg-[#2a2a2a] hover:bg-[#333]'
                      : 'text-[#888] border-[#2e2e2e] hover:text-white hover:bg-[#1e1e1e]'
                  )}
                >
                  {selectionMode ? 'Cancel' : 'Select'}
                </button>
              )}
            </div>
          </div>

          {/* Episode rows or empty state */}
          {totalAll === 0 ? (
            <div className="text-center py-16 text-[#555]">
              <Archive className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-bold text-white">Nothing archived yet</p>
              <p className="text-sm mt-1">Mark episodes as complete to move them here</p>
            </div>
          ) : filteredPublished.length === 0 ? (
            <div className="text-center py-10 text-[#555]">
              <p className="text-sm">No episodes match the current filters</p>
              <button
                onClick={() => { setSearch(''); setClientFilter(''); setDateFrom(''); setDateTo(''); setTemplateFilter('') }}
                className="text-xs text-[#888] underline mt-1"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="border border-[#2e2e2e] rounded-xl overflow-visible divide-y divide-[#242424]">
              {/* Select all header row */}
              {selectionMode && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-[#111] rounded-t-xl">
                  <button
                    onClick={selectionCount < totalVisible ? selectAll : deselectAll}
                    className="text-[13px] text-[#f7931a] hover:text-[#ff9d2e] font-medium transition-colors"
                  >
                    {selectionCount < totalVisible
                      ? `Select all ${totalVisible} episode${totalVisible !== 1 ? 's' : ''}${hasActiveFilter ? ' matching filters' : ''}`
                      : 'Deselect all'}
                  </button>
                  {selectionCount > 0 && selectionCount < totalVisible && (
                    <span className="text-[12px] text-[#555]">{selectionCount} selected</span>
                  )}
                </div>
              )}
              {filteredPublished.map(ep => {
                const isSelected = selectedIds.has(ep.id)
                const isFading = fadingIds.has(ep.id)
                return (
                  <div
                    key={ep.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 transition-colors',
                      isSelected ? 'bg-[#1a1400]' : 'hover:bg-[#111111]',
                    )}
                    style={{
                      borderLeft: isSelected ? '2px solid rgba(247,147,26,0.7)' : '2px solid transparent',
                      opacity: isFading ? 0 : 1,
                      transform: isFading ? 'scale(0.98)' : 'scale(1)',
                      transition: isFading
                        ? 'opacity 350ms ease, transform 350ms ease'
                        : 'background 150ms, border-color 150ms',
                    }}
                  >
                    {/* Checkbox */}
                    {selectionMode && (
                      <button onClick={() => toggleSelection(ep.id)} className="shrink-0 p-0.5">
                        <div className={cn(
                          'w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
                          isSelected ? 'bg-[#f7931a] border-[#f7931a]' : 'border-[#444] hover:border-[#666]'
                        )}>
                          {isSelected && <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />}
                        </div>
                      </button>
                    )}

                    {/* Episode info */}
                    <a href={`/episodes/${ep.id}`} className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{ep.guest_name}</p>
                      <p className="text-xs text-[#666]">
                        {ep.client_label} · Completed {ep.published_at ? formatDate(ep.published_at) : ''}
                      </p>
                    </a>

                    {/* Actions — outside selection mode */}
                    {!selectionMode && (
                      <>
                        <a
                          href={`/episodes/${ep.id}`}
                          className="p-1.5 rounded hover:bg-[#1e1e1e] text-[#555] hover:text-white transition-colors shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        {/* Issue 1: three-dot button — uses fixed dropdown */}
                        <button
                          className="shrink-0 p-1.5 rounded hover:bg-[#1e1e1e] text-[#555] hover:text-white transition-colors"
                          onClick={e => { e.stopPropagation(); handleMenuOpen(ep.id, e.currentTarget) }}
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Issue 1: fixed-position dropdown — rendered outside list, escapes overflow:hidden */}
      {openMenuId && menuPos && openMenuEp && (
        <div
          style={{
            position: 'fixed',
            top: menuPos.top,
            right: menuPos.right,
            zIndex: 9999,
            width: 192,
            background: '#222222',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {canPublish && (
            <button
              onClick={() => { onTogglePublish(openMenuEp.id, false); setOpenMenuId(null); setMenuPos(null) }}
              className="w-full text-left px-4 py-2.5 text-sm text-[#888] hover:text-white hover:bg-[#2a2a2a] transition-colors"
            >
              Restore to active
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => { setSingleDeleteTarget(openMenuEp); setOpenMenuId(null); setMenuPos(null) }}
              className="w-full text-left px-4 py-2.5 text-sm text-[#ff3c00] hover:bg-[#2a2a2a] transition-colors"
            >
              Delete permanently
            </button>
          )}
        </div>
      )}

      {/* ── Sticky selection bar ──────────────────────────────────────────── */}
      {selectionMode && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 border-t"
          style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <div className="px-8 py-4 flex items-center gap-4 max-w-[1400px] mx-auto">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <span className="text-[13px] font-semibold text-white whitespace-nowrap">
                {selectionCount} episode{selectionCount !== 1 ? 's' : ''} selected
              </span>
              {hasActiveFilter && selectionCount > 0 && totalVisible < totalAll && (
                <span className="text-[12px] text-[#555] whitespace-nowrap">
                  ({totalAll} total in archive)
                </span>
              )}
              {selectionCount < totalVisible ? (
                <button
                  onClick={selectAll}
                  className="text-[13px] text-[#f7931a] hover:text-[#ff5a00] underline underline-offset-2 transition-colors whitespace-nowrap"
                >
                  Select all {totalVisible}{hasActiveFilter && totalVisible < totalAll ? ' matching' : ''}
                </button>
              ) : totalVisible > 0 ? (
                <button
                  onClick={deselectAll}
                  className="text-[13px] text-[#666] hover:text-white underline underline-offset-2 transition-colors whitespace-nowrap"
                >
                  Deselect all
                </button>
              ) : null}
            </div>
            <button
              onClick={() => setBulkDeleteOpen(true)}
              disabled={selectionCount === 0}
              className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-[#dc2626] hover:bg-[#b91c1c] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete selected
            </button>
          </div>
        </div>
      )}

      {/* ── Bulk delete modal ─────────────────────────────────────────────── */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => { setBulkDeleteOpen(false); setDeleteInput('') }} />
          <div className="relative w-full max-w-lg rounded-2xl p-6 space-y-5" style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h2 className="text-xl font-bold text-white">
              Permanently delete {selectionCount} episode{selectionCount !== 1 ? 's' : ''}?
            </h2>
            {/* Episode list */}
            <div className="space-y-1.5">
              {selectedEpisodes.slice(0, 5).map(ep => (
                <p key={ep.id} className="text-sm text-[#888]">
                  <span className="text-white font-medium">{ep.guest_name}</span>
                  {' · '}{ep.client_label}
                  {ep.published_at && <span> · Completed {formatDate(ep.published_at)}</span>}
                </p>
              ))}
              {selectionCount > 5 && (
                <p className="text-sm text-[#555] italic">+{selectionCount - 5} more</p>
              )}
            </div>
            {/* Warning */}
            <div className="rounded-lg px-4 py-3 text-sm text-[#ff3c00] bg-[#ff3c00]/10 border border-[#ff3c00]/20">
              This action is permanent and cannot be undone. All tasks, comments, and activity for these episodes will be deleted forever.
            </div>
            {/* Type DELETE */}
            <div>
              <label className="text-[12px] text-[#888] font-medium block mb-2">
                Type DELETE to confirm
              </label>
              <input
                type="text"
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                autoFocus
                className="w-full bg-[#111] border border-[#2e2e2e] focus:border-[#ff3c00]/40 rounded-lg px-4 py-2.5 text-sm text-white placeholder-[#333] outline-none font-mono tracking-widest"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setBulkDeleteOpen(false); setDeleteInput('') }}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-[#888] border border-[#2e2e2e] hover:text-white hover:border-[#3a3a3a] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => doDelete(Array.from(selectedIds))}
                disabled={deleteInput !== 'DELETE' || deleting}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#dc2626] hover:bg-[#b91c1c] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Single delete modal ───────────────────────────────────────────── */}
      {singleDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setSingleDeleteTarget(null)} />
          <div className="relative w-full max-w-md rounded-2xl p-6 space-y-4" style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h2 className="text-xl font-bold text-white">
              Delete {singleDeleteTarget.guest_name} permanently?
            </h2>
            <p className="text-sm text-[#888]">
              This cannot be undone. All tasks and comments for this episode will be deleted.
            </p>
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => setSingleDeleteTarget(null)}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-[#888] border border-[#2e2e2e] hover:text-white hover:border-[#3a3a3a] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => doDelete([singleDeleteTarget!.id])}
                disabled={deleting}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#dc2626] hover:bg-[#b91c1c] disabled:opacity-40 text-white transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl"
          style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <Trash2 className="w-4 h-4 text-[#ff3c00] shrink-0" />
          <p className="text-sm font-semibold text-white">{toast}</p>
        </div>
      )}
    </>
  )
}

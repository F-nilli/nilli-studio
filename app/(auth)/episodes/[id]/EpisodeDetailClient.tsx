'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Lock, AlertCircle, Pencil, Check, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Episode, Task, User, Track, Comment, canEditDates as canEditDatesRole, canApprove, canManageClients } from '@/lib/types'
import { EpisodeImages } from '@/components/episodes/EpisodeImages'
import { StatusBadge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { CommentPanel } from '@/components/tasks/CommentPanel'
import { cn, formatDate, isOverdue, toDatetimeLocal, fromDatetimeLocal } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { sendNotification } from '@/lib/notifications'
import { parseISO, format } from 'date-fns'

interface TaskComment { count: number; latest: string }

interface Props {
  currentUser: User
  episode: Episode
  initialTasks: Task[]
  taskComments: Record<string, TaskComment>
  allUsers: User[]
  initialTaskId?: string
  initialCommentId?: string
}

const TRACK_ORDER: Track[] = ['Long-form', 'Trailer', 'Thumbnails', 'Clips & Shorts', 'Review', 'Publishing']
const FOOTAGE_TRACKS = ['Trailer', 'Clips & Shorts', 'Long-form']

function getDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function getDownstreamTaskIds(taskId: string, allTasks: Task[]): string[] {
  const result: string[] = []
  const queue = [taskId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const t of allTasks) {
      if (t.dep_task_ids.includes(current) && !result.includes(t.id)) {
        result.push(t.id)
        queue.push(t.id)
      }
    }
  }
  return result
}

type SupabaseClientType = ReturnType<typeof createClient>

async function checkAndUnlockDependencies(supabase: SupabaseClientType, episodeId: string) {
  const { data: allTasks } = await supabase.from('tasks').select('*').eq('episode_id', episodeId)
  if (!allTasks) return
  const approvedIds = new Set(allTasks.filter(t => t.status === 'approved' || t.status === 'done').map(t => t.id))
  for (const t of allTasks) {
    if (t.status === 'locked' && t.dep_task_ids.length > 0) {
      const allDepsApproved = t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
      if (allDepsApproved) {
        const updateData: Record<string, unknown> = { status: 'in_progress' }
        if (t.due_after_dep_hours) {
          updateData.due_date = new Date(Date.now() + t.due_after_dep_hours * 60 * 60 * 1000).toISOString()
        }
        await supabase.from('tasks').update(updateData).eq('id', t.id)
        const { data: assignee } = await supabase.from('users').select('*').eq('id', t.assignee_id).single()
        if (assignee) {
          const { data: episode } = await supabase.from('episodes').select('*').eq('id', episodeId).single()
          await sendNotification(supabase, {
            userId: assignee.id,
            type: 'task_unlocked',
            title: 'New task started',
            body: `"${t.label}" is now in progress for ${episode ? `${episode.guest_name} / ${episode.client_label}` : ''}`,
            taskId: t.id,
            episodeId,
          })
        }
      }
    }
  }
}

// ─── Main client ──────────────────────────────────────────────────────────────

export function EpisodeDetailClient({ currentUser, episode, initialTasks, taskComments, allUsers, initialTaskId, initialCommentId }: Props) {
  const supabase = createClient()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [activeTaskFilter, setActiveTaskFilter] = useState<Task | null>(null)
  const [allComments, setAllComments] = useState<Comment[]>([])
  const [lastRead, setLastRead] = useState<Record<string, string>>({})
  const [recentlyUnlocked, setRecentlyUnlocked] = useState<Set<string>>(new Set())

  const canEditDates = canEditDatesRole(currentUser)
  const canEdit = canApprove(currentUser)

  // Load last-read timestamps from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`lastRead:${episode.id}`)
      if (stored) setLastRead(JSON.parse(stored))
    } catch {}
  }, [episode.id])

  // Auto-select task from URL param (notification/message deep-link)
  useEffect(() => {
    if (!initialTaskId) return
    const task = initialTasks.find(t => t.id === initialTaskId)
    if (task) {
      setExpandedTaskId(initialTaskId)
      setActiveTaskFilter(task)
      const now = new Date().toISOString()
      setLastRead(prev => {
        const next = { ...prev, [initialTaskId]: now }
        try { localStorage.setItem(`lastRead:${episode.id}`, JSON.stringify(next)) } catch {}
        return next
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch all episode comments on mount
  useEffect(() => {
    async function fetchComments() {
      const { data } = await supabase
        .from('comments')
        .select('*, author:users(*)')
        .eq('episode_id', episode.id)
        .order('created_at', { ascending: true })
      if (data) setAllComments(data as unknown as Comment[])
    }
    fetchComments()
  }, [episode.id])

  // Realtime: new comments (deduplicated)
  useEffect(() => {
    const channel = supabase
      .channel(`comments-${episode.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `episode_id=eq.${episode.id}` },
        async (payload) => {
          const { data } = await supabase
            .from('comments')
            .select('*, author:users(*)')
            .eq('id', payload.new.id)
            .single()
          if (data) {
            setAllComments(prev => {
              if (prev.some(c => c.id === (data as unknown as Comment).id)) return prev
              return [...prev, data as unknown as Comment]
            })
          }
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [episode.id])

  // Realtime: task updates
  useEffect(() => {
    const channel = supabase
      .channel(`tasks-${episode.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `episode_id=eq.${episode.id}` },
        (payload) => {
          setTasks(prev => prev.map(t => t.id === payload.new.id ? { ...t, ...payload.new } : t))
          setActiveTaskFilter(prev => prev?.id === payload.new.id ? { ...prev, ...payload.new } as Task : prev)
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [episode.id])

  // Derived task comment counts (live, non-internal only)
  const liveTaskComments = useMemo(() => {
    if (allComments.length === 0) return taskComments
    const result: Record<string, { count: number; latest: string }> = {}
    for (const c of [...allComments].reverse()) {
      if (!c.task_id || c.internal) continue
      if (!result[c.task_id]) result[c.task_id] = { count: 0, latest: c.body }
      result[c.task_id].count++
    }
    return result
  }, [allComments, taskComments])

  function hasUnread(taskId: string): boolean {
    const lastReadAt = lastRead[taskId]
    if (!lastReadAt) return allComments.some(c => c.task_id === taskId && !c.internal)
    return allComments.some(c => c.task_id === taskId && !c.internal && c.created_at > lastReadAt)
  }

  function markTaskRead(taskId: string) {
    const now = new Date().toISOString()
    setLastRead(prev => {
      const next = { ...prev, [taskId]: now }
      try { localStorage.setItem(`lastRead:${episode.id}`, JSON.stringify(next)) } catch {}
      return next
    })
  }

  function handleTaskClick(task: Task) {
    setExpandedTaskId(prev => prev === task.id ? null : task.id)
    setActiveTaskFilter(task)
    markTaskRead(task.id)
  }

  function handleTaskUpdate(updated: Task) {
    const unlockingIds: string[] = []

    setTasks(prev => {
      // Update the task itself
      let newTasks = prev.map(t => {
        if (t.id !== updated.id) return t
        return {
          ...t, ...updated,
          assignee: updated.assignee ?? t.assignee,
          approver: updated.approver ?? t.approver,
        }
      })

      // Optimistically unlock downstream tasks immediately (no DB round-trip wait)
      if (updated.status === 'approved' || updated.status === 'done') {
        const approvedIds = new Set(newTasks.filter(t => t.status === 'approved' || t.status === 'done').map(t => t.id))
        newTasks = newTasks.map(t => {
          if (t.status === 'locked' && t.dep_task_ids.length > 0 &&
              t.dep_task_ids.every(id => approvedIds.has(id))) {
            unlockingIds.push(t.id)
            return {
              ...t,
              status: 'in_progress' as const,
              due_date: t.due_after_dep_hours
                ? new Date(Date.now() + t.due_after_dep_hours * 3600 * 1000).toISOString()
                : t.due_date,
            }
          }
          return t
        })
      }

      return newTasks
    })

    // Trigger unlock animation for newly unblocked tasks
    if (unlockingIds.length > 0) {
      setRecentlyUnlocked(new Set(unlockingIds))
      setTimeout(() => setRecentlyUnlocked(new Set()), 1500)
    }

    setActiveTaskFilter(prev => {
      if (!prev || prev.id !== updated.id) return prev
      return {
        ...prev, ...updated,
        assignee: updated.assignee ?? prev.assignee,
        approver: updated.approver ?? prev.approver,
      }
    })
  }

  function handleNewComment(comment: Comment) {
    setAllComments(prev => {
      if (prev.some(c => c.id === comment.id)) return prev
      return [...prev, comment]
    })
    if (comment.task_id) markTaskRead(comment.task_id)
  }

  function handleReplaceComment(tempId: string, real: Comment) {
    setAllComments(prev => prev.map(c => c.id === tempId ? real : c))
  }

  function handleRemoveComment(id: string) {
    setAllComments(prev => prev.filter(c => c.id !== id))
  }

  async function handleDateChange(taskId: string, oldDateStr: string | null, newDatetimeLocal: string) {
    const newDateStr = fromDatetimeLocal(newDatetimeLocal)
    const downstream = getDownstreamTaskIds(taskId, tasks)
    const updates: { id: string; due_date: string }[] = [{ id: taskId, due_date: newDateStr }]

    if (oldDateStr && downstream.length > 0) {
      const delta = new Date(newDateStr).getTime() - new Date(oldDateStr).getTime()
      for (const downId of downstream) {
        const downTask = tasks.find(t => t.id === downId)
        if (downTask?.due_date && downTask.status === 'locked') {
          const shifted = new Date(new Date(downTask.due_date).getTime() + delta)
          updates.push({ id: downId, due_date: format(shifted, "yyyy-MM-dd'T'HH:mm:ss") })
        }
      }
    }

    await Promise.all(updates.map(u =>
      supabase.from('tasks').update({ due_date: u.due_date }).eq('id', u.id)
    ))
    setTasks(prev => prev.map(t => {
      const u = updates.find(x => x.id === t.id)
      return u ? { ...t, due_date: u.due_date } : t
    }))
  }

  const daysUntil = Math.round(
    (parseISO(episode.release_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div className="flex items-start gap-5">
      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            href={currentUser.role === 'admin' ? '/board' : '/dashboard'}
            className="p-1.5 rounded-md hover:bg-[#1e1e1e] text-[#888] shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] text-[#888] font-medium">{episode.client_label}</span>
              <span className="text-[#444]">·</span>
              <span className={cn('text-[13px] font-medium',
                daysUntil < 0 ? 'text-[#ff3c00]' : daysUntil < 3 ? 'text-yellow-500' : 'text-[#888]'
              )}>
                {daysUntil < 0 ? `Released ${Math.abs(daysUntil)}d ago` :
                 daysUntil === 0 ? 'Releases today' :
                 `Releases in ${daysUntil}d · ${format(parseISO(episode.release_date), 'MMM d, yyyy')}`}
              </span>
            </div>
            <h1 className="text-[30px] font-bold text-white leading-tight">{episode.guest_name}</h1>
            {episode.source_episode_id && episode.source?.guest_name && episode.template_name && episode.template_name !== 'Default' && (
              <Link
                href={`/episodes/${episode.source.id}`}
                className="flex items-center gap-1 text-xs text-[#f7931a]/70 hover:text-[#f7931a] transition-colors mt-0.5"
              >
                <span className="text-[10px]">↗</span>
                <span>Spawned from: {episode.source.template_name ?? 'Default'} — {episode.source.guest_name}</span>
              </Link>
            )}
          </div>
          {episode.footage_url && (
            <a
              href={episode.footage_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e1e] hover:bg-[#333] text-[#ccc] rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />Footage
            </a>
          )}
        </div>

        {/* Brief & Notes */}
        <BriefNotes
          episodeId={episode.id}
          initialNotes={episode.notes}
          canEdit={canEdit}
          canManage={canManageClients(currentUser)}
          currentUserId={currentUser.id}
        />

        {/* 2-column track grid */}
        <div className="grid grid-cols-2 gap-4">
          {TRACK_ORDER.map(track => {
            const trackTasks = tasks.filter(t => t.track === track)
            if (trackTasks.length === 0) return null
            const trackColor = TRACK_COLORS[track]
            const done = trackTasks.filter(t => t.status === 'approved' || t.status === 'done').length
            return (
              <TrackPanel
                key={track}
                track={track}
                trackColor={trackColor}
                tasks={trackTasks}
                done={done}
                canEditDates={canEditDates}
                liveTaskComments={liveTaskComments}
                hasUnread={hasUnread}
                activeTask={activeTaskFilter}
                expandedTaskId={expandedTaskId}
                recentlyUnlocked={recentlyUnlocked}
                currentUser={currentUser}
                episode={episode}
                onTaskClick={handleTaskClick}
                onDateChange={(taskId, oldDate, newDate) => handleDateChange(taskId, oldDate, newDate)}
                onTaskUpdate={handleTaskUpdate}
              />
            )
          })}
        </div>
      </div>

      {/* Comment panel — 320px fixed */}
      <div className="w-80 shrink-0 sticky top-6 self-start">
        <CommentPanel
          episodeId={episode.id}
          episodeClientKey={episode.client_key}
          episodeGuestName={episode.guest_name}
          episodeClientLabel={episode.client_label}
          allComments={allComments}
          tasks={tasks}
          currentUser={currentUser}
          allUsers={allUsers}
          activeTask={activeTaskFilter}
          hasUnread={hasUnread}
          onClearFilter={() => setActiveTaskFilter(null)}
          onNewComment={handleNewComment}
          onReplaceComment={handleReplaceComment}
          onRemoveComment={handleRemoveComment}
          highlightCommentId={initialCommentId}
        />
      </div>
    </div>
  )
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function BriefNotes({ episodeId, initialNotes, canEdit, canManage, currentUserId }: {
  episodeId: string
  initialNotes: string | null
  canEdit: boolean
  canManage: boolean
  currentUserId: string
}) {
  const supabase = createClient()
  const [notes, setNotes] = useState(initialNotes || '')
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const isEmpty = !notes.trim()
  const lines = notes.split('\n')
  const isLong = lines.length > 2 || notes.length > 160
  const preview = isLong && !expanded ? lines.slice(0, 2).join('\n') : notes

  async function handleSave() {
    setSaving(true)
    await supabase.from('episodes').update({ notes: notes || null }).eq('id', episodeId)
    setSaving(false)
    setSaved(true)
    setEditing(false)
    setTimeout(() => setSaved(false), 2500)
  }

  if (isEmpty && !editing) {
    if (!canEdit) return null
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-left text-sm text-[#3a3a3a] hover:text-[#555] italic py-3 px-4 rounded-xl border border-dashed border-[#2e2e2e] hover:border-[#444] transition-colors"
      >
        Add notes for the team...
      </button>
    )
  }

  return (
    <div className="rounded-xl p-5 space-y-2" style={{ background: 'linear-gradient(135deg, rgba(247,147,26,0.06) 0%, #1e1e1e 50%)', border: '1px solid rgba(255,255,255,0.09)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#666] uppercase tracking-wider">Notes</span>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-400 font-medium">Saved</span>}
          {canEdit && !editing && (
            <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-[#2e2e2e] text-[#555] hover:text-white transition-colors">
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {editing && canEdit ? (
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            autoFocus
            placeholder="Add notes for the team..."
            rows={4}
            className="w-full rounded-lg px-3 py-2 resize-none focus:outline-none placeholder-[#444]"
            style={{ fontSize: 15, fontWeight: 400, lineHeight: 1.7, color: 'rgba(255,255,255,0.85)', background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.12)', outline: 'none' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(247,147,26,0.6)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
          />
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => { setNotes(initialNotes || ''); setEditing(false) }}
              className="px-3 py-1.5 text-sm text-[#888] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary px-4 py-1.5 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="whitespace-pre-wrap" style={{ fontSize: 15, fontWeight: 400, lineHeight: 1.7, color: 'rgba(255,255,255,0.85)' }}>
            {preview}{isLong && !expanded ? ' …' : ''}
          </p>
          <div className="flex items-center gap-3 mt-1">
            {isLong && (
              <button onClick={() => setExpanded(!expanded)} className="text-xs text-[#555] hover:text-[#888] transition-colors">
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
            {canEdit && (
              <button onClick={() => setEditing(true)} className="text-xs text-[#444] hover:text-[#666] transition-colors">
                Edit
              </button>
            )}
          </div>
          <EpisodeImages
            episodeId={episodeId}
            canManage={canManage}
            currentUserId={currentUserId}
          />
        </div>
      )}
    </div>
  )
}

// ─── Track panel ───────────────────────────────────────────────────────────────

interface TrackPanelProps {
  track: Track
  trackColor: string
  tasks: Task[]
  done: number
  canEditDates: boolean
  liveTaskComments: Record<string, { count: number; latest: string }>
  hasUnread: (taskId: string) => boolean
  activeTask: Task | null
  expandedTaskId: string | null
  recentlyUnlocked: Set<string>
  currentUser: User
  episode: Episode
  onTaskClick: (task: Task) => void
  onDateChange: (taskId: string, oldDate: string | null, newDate: string) => void
  onTaskUpdate: (task: Task) => void
}

function TrackPanel({ track, trackColor, tasks, done, canEditDates, liveTaskComments, hasUnread, activeTask, expandedTaskId, recentlyUnlocked, currentUser, episode, onTaskClick, onDateChange, onTaskUpdate }: TrackPanelProps) {
  return (
    <div className="bg-[#1e1e1e] rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ background: `linear-gradient(135deg, ${trackColor}18 0%, transparent 55%)`, borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor, boxShadow: `0 0 7px ${trackColor}99` }} />
          <span className="text-[12px] font-semibold text-white uppercase tracking-[0.1em]">{track}</span>
        </div>
        <span className="text-[12px] text-white/30">{done}/{tasks.length}</span>
      </div>
      {/* Task cards */}
      <div className="divide-y" style={{ '--tw-divide-opacity': 1, borderColor: 'rgba(255,255,255,0.06)' } as React.CSSProperties}>
        {tasks.map(task => (
          <TrackTaskCard
            key={task.id}
            task={task}
            isSelected={activeTask?.id === task.id}
            isExpanded={expandedTaskId === task.id}
            isRecentlyUnlocked={recentlyUnlocked.has(task.id)}
            canEditDates={canEditDates}
            taskComment={liveTaskComments[task.id] || null}
            hasUnread={hasUnread(task.id)}
            currentUser={currentUser}
            episode={episode}
            onDateChange={(oldDate, newDate) => onDateChange(task.id, oldDate, newDate)}
            onClick={() => onTaskClick(task)}
            onTaskUpdate={onTaskUpdate}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Track task card ───────────────────────────────────────────────────────────

interface TrackTaskCardProps {
  task: Task
  isSelected: boolean
  isExpanded: boolean
  isRecentlyUnlocked: boolean
  canEditDates: boolean
  taskComment: { count: number; latest: string } | null
  hasUnread: boolean
  currentUser: User
  episode: Episode
  onDateChange: (oldDate: string | null, newDate: string) => void
  onClick: () => void
  onTaskUpdate: (task: Task) => void
}

function TrackTaskCard({ task, isSelected, isExpanded, isRecentlyUnlocked, canEditDates, taskComment, hasUnread, currentUser, episode, onDateChange, onClick, onTaskUpdate }: TrackTaskCardProps) {
  const supabase = createClient()
  const isLocked = task.status === 'locked'
  const overdue = isOverdue(task.due_date, task.status)
  const [editingDate, setEditingDate] = useState(false)
  const [dateValue, setDateValue] = useState(toDatetimeLocal(task.due_date))
  const [actionLoading, setActionLoading] = useState(false)
  const [sendBackOpen, setSendBackOpen] = useState(false)
  const [sendBackDate, setSendBackDate] = useState('')
  const [sendBackReason, setSendBackReason] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isAssignee = task.assignee_id === currentUser.id
  const isApprover = task.requires_approval &&
    (currentUser.id === task.approver_id || currentUser.role === 'admin')

  const showAssigneeAction = !isLocked && isAssignee &&
    (task.status === 'ready' || task.status === 'in_progress' || task.status === 'revision')
  const showApproverActions = !isLocked && isApprover && task.status === 'in_review'

  const actionLabel =
    task.status === 'ready' ? 'Start' :
    task.status === 'in_progress' ? (task.approver_id ? 'Submit for Review' : 'Mark Done') :
    task.status === 'revision' ? 'Resubmit' :
    ''

  const [actionError, setActionError] = useState<string | null>(null)

  // Close send back form if status changes (e.g., via realtime)
  useEffect(() => {
    if (task.status !== 'in_review') setSendBackOpen(false)
  }, [task.status])

  useEffect(() => {
    if (!actionError) return
    const t = setTimeout(() => setActionError(null), 4000)
    return () => clearTimeout(t)
  }, [actionError])

  useEffect(() => {
    if (!editingDate) setDateValue(toDatetimeLocal(task.due_date))
  }, [task.due_date, editingDate])

  useEffect(() => {
    if (editingDate) inputRef.current?.focus()
  }, [editingDate])

  function commitDate() {
    if (dateValue && dateValue !== toDatetimeLocal(task.due_date)) {
      onDateChange(task.due_date, dateValue)
    }
    setEditingDate(false)
  }

  async function handleStatusAction() {
    const resolvedStatus =
      task.status === 'ready' ? 'in_progress' :
      task.status === 'in_progress' ? (task.approver_id ? 'in_review' : 'done') :
      task.status === 'revision' ? 'in_review' :
      null

    if (!resolvedStatus) return
    setActionLoading(true)
    setActionError(null)

    const updatePayload: Record<string, unknown> = { status: resolvedStatus }
    if (resolvedStatus === 'in_review') updatePayload.review_started_at = new Date().toISOString()

    if (resolvedStatus === 'in_review' && task.requires_approval && task.approver_id && task.approver_id !== currentUser.id) {
      await sendNotification(supabase, {
        userId: task.approver_id,
        type: 'task_submitted_review',
        title: 'Task submitted for review',
        body: `${currentUser.name} submitted "${task.label}" for review`,
        taskId: task.id,
        episodeId: task.episode_id,
      })
      fetch('/api/slack/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'review_submitted', episodeId: task.episode_id, taskLabel: task.label, assigneeName: currentUser.name }),
      }).catch(() => {})
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', task.id)
      .select('*')
      .single()

    if (error) {
      console.error('Task update error:', error.message, error.code, error.details)
      setActionError(error.message || 'Failed to update task')
      setActionLoading(false)
      return
    }

    if (data) {
      onTaskUpdate(data as unknown as Task)
      try {
        await checkAndUnlockDependencies(supabase, task.episode_id)
      } catch (depErr: unknown) {
        console.error('Dep unlock error:', depErr)
      }
      if (resolvedStatus === 'approved' || resolvedStatus === 'done') {
        fetch('/api/episodes/check-triggers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, episodeId: task.episode_id }),
        }).catch(() => {})
      }
    }
    setActionLoading(false)
  }

  async function handleApprove() {
    setActionLoading(true)
    setActionError(null)

    const { data, error } = await supabase
      .from('tasks').update({ status: 'approved' }).eq('id', task.id)
      .select('*').single()

    if (error) {
      console.error('Approve error:', error.message, error.code, error.details)
      setActionError(error.message || 'Failed to approve')
      setActionLoading(false)
      return
    }

    if (data) {
      onTaskUpdate(data as unknown as Task)
      try {
        await checkAndUnlockDependencies(supabase, task.episode_id)
      } catch (depErr: unknown) {
        console.error('Dep unlock error:', depErr)
      }
      if (task.assignee_id !== currentUser.id) {
        await sendNotification(supabase, {
          userId: task.assignee_id,
          type: 'task_approved',
          title: 'Task approved',
          body: `"${task.label}" was approved by ${currentUser.name}`,
          taskId: task.id,
          episodeId: task.episode_id,
        })
      }
      fetch('/api/slack/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'approval', episodeId: task.episode_id, completedTaskLabel: task.label, nextTasks: [] }),
      }).catch(() => {})
      fetch('/api/episodes/check-triggers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, episodeId: task.episode_id }),
      }).catch(() => {})
    }
    setActionLoading(false)
  }

  async function handleSendBack() {
    setActionLoading(true)
    setActionError(null)

    const { data, error } = await supabase
      .from('tasks')
      .update({ status: 'revision', due_date: sendBackDate || null })
      .eq('id', task.id)
      .select('*')
      .single()

    if (error) {
      console.error('Send back error:', error.message, error.code, error.details)
      setActionError(error.message || 'Failed to send back')
      setActionLoading(false)
      return
    }

    if (data) {
      onTaskUpdate(data as unknown as Task)
      const { data: assignee } = await supabase.from('users').select('*').eq('id', task.assignee_id).single()
      if (assignee) {
        const noteBody = sendBackReason
          ? `"${task.label}" was sent back: ${sendBackReason}${sendBackDate ? `. Due: ${format(new Date(sendBackDate), 'MMM d, yyyy')}` : ''}`
          : `"${task.label}" was sent back for revision by ${currentUser.name}${sendBackDate ? `. Due: ${format(new Date(sendBackDate), 'MMM d, yyyy')}` : ''}`
        await sendNotification(supabase, {
          userId: assignee.id,
          type: 'task_revision',
          title: 'Task sent back for revision',
          body: noteBody,
          taskId: task.id,
          episodeId: task.episode_id,
        })
        fetch('/api/slack/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'revision',
            episodeId: task.episode_id,
            taskLabel: task.label,
            assigneeName: assignee.name,
            dueDate: sendBackDate ? format(new Date(sendBackDate), 'MMM d') : undefined,
          }),
        }).catch(() => {})
      }
      setSendBackOpen(false)
      setSendBackDate('')
      setSendBackReason('')
    }
    setActionLoading(false)
  }

  const commentCount = taskComment?.count ?? 0
  const showFootageLink = episode.footage_url && FOOTAGE_TRACKS.includes(task.track)

  return (
    <div className={cn(
      'group relative transition-colors',
      isSelected
        ? 'bg-[#2e2e2e] border-l-[3px] border-[#ff3c00]'
        : isRecentlyUnlocked
          ? 'border-l-[3px] task-unlock bg-[#272727]'
          : 'bg-[#272727] border-l-[3px] border-transparent hover:bg-[#2a2a2a]',
      isLocked && 'opacity-35'
    )}>
      {/* Main row */}
      <button
        onClick={isLocked ? undefined : onClick}
        className={cn('w-full text-left px-4 py-[14px]', isLocked && 'cursor-default')}
      >
        {/* Row 1: status + label + avatar */}
        <div className="flex items-center gap-2 mb-1.5">
          {isLocked
            ? <Lock className="w-3 h-3 text-[#555] shrink-0" />
            : <StatusBadge status={task.status} />
          }
          <span className={cn(
            'text-[15px] truncate flex-1 leading-snug',
            isLocked ? 'text-white/35 font-normal' : overdue ? 'text-white font-medium' : 'text-white/90 font-medium'
          )}>
            {task.label}
          </span>
          {task.assignee && !isLocked && (
            <Avatar
              name={task.assignee.name}
              color={task.assignee.avatar_color}
              size="sm"
              avatarUrl={task.assignee.avatar_url}
            />
          )}
        </div>

        {/* Row 2: due date + comment count */}
        {!isLocked && (
          <div className="flex items-center gap-2.5 pl-[22px]">
            {task.due_date && !editingDate && (
              <span className={cn('text-[13px] tabular-nums', overdue ? 'text-[#ff5533]' : 'text-white/40')}>
                {formatDate(task.due_date)}
              </span>
            )}
            {commentCount > 0 && (
              <span className="flex items-center gap-1 text-xs">
                <MessageSquare className={cn('w-3 h-3 shrink-0', hasUnread ? 'text-[#f7931a]' : 'text-[#555]')} />
                <span className={hasUnread ? 'text-[#f7931a]' : 'text-[#555]'}>{commentCount}</span>
                {hasUnread && <span className="w-1 h-1 rounded-full bg-[#f7931a] ml-0.5" />}
              </span>
            )}
            {overdue && <AlertCircle className="w-3 h-3 text-[#ff3c00] shrink-0" />}
          </div>
        )}
      </button>

      {/* Inline action buttons */}
      {(showAssigneeAction || showApproverActions) && (
        <div className="px-4 pb-4 flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {showAssigneeAction && (
            <button
              onClick={handleStatusAction}
              disabled={actionLoading}
              className="btn-primary flex-1 py-1.5 px-3 disabled:cursor-not-allowed cursor-pointer text-white text-xs font-semibold rounded-lg"
            >
              {actionLoading ? '…' : actionLabel}
            </button>
          )}
          {showApproverActions && (
            <>
              <button
                onClick={() => setSendBackOpen(s => !s)}
                disabled={actionLoading}
                className={cn(
                  'flex-1 py-1.5 px-3 border text-xs font-semibold rounded-lg transition-colors disabled:opacity-50',
                  sendBackOpen
                    ? 'border-[#ff3c00]/70 bg-[#ff3c00]/10 text-[#ff6644] cursor-pointer'
                    : 'border-[#ff3c00]/30 hover:border-[#ff3c00]/60 hover:bg-[#ff3c00]/5 text-[#ff6644] cursor-pointer'
                )}
              >
                Send Back
              </button>
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="btn-green flex-1 py-1.5 px-3 disabled:cursor-not-allowed cursor-pointer text-white text-xs font-semibold rounded-lg"
              >
                {actionLoading ? '…' : 'Approve'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Send back inline form */}
      {sendBackOpen && (
        <div
          className="mx-4 mb-4 p-4 bg-[#2a2a2a] rounded-lg space-y-2.5"
          style={{ border: '1px solid rgba(255,255,255,0.09)' }}
          onClick={e => e.stopPropagation()}
        >
          <p className="text-xs font-semibold text-[#888]">Send back for revision</p>
          <div>
            <label className="text-[10px] text-[#555] uppercase tracking-wider">Revised due date</label>
            <input
              type="date"
              value={sendBackDate}
              min={format(new Date(), 'yyyy-MM-dd')}
              onChange={e => setSendBackDate(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 bg-[#141414] border border-[#2e2e2e] rounded text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#ff3c00]"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#555] uppercase tracking-wider">Reason (optional)</label>
            <textarea
              value={sendBackReason}
              onChange={e => setSendBackReason(e.target.value)}
              placeholder="Add context for the assignee..."
              rows={2}
              className="w-full mt-1 px-2 py-1.5 bg-[#141414] border border-[#2e2e2e] rounded text-xs text-white placeholder-[#444] resize-none focus:outline-none focus:ring-1 focus:ring-[#ff3c00] leading-relaxed"
            />
          </div>
          <div className="flex items-center gap-3 pt-0.5">
            <button
              onClick={() => { setSendBackOpen(false); setSendBackDate(''); setSendBackReason('') }}
              className="text-xs text-[#555] hover:text-[#888] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSendBack}
              disabled={actionLoading}
              className="ml-auto py-1 px-3 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-white text-xs font-semibold rounded transition-colors"
            >
              {actionLoading ? 'Sending…' : 'Confirm Send Back'}
            </button>
          </div>
        </div>
      )}

      {/* Expandable detail panel */}
      {isExpanded && !isLocked && (
        <div
          className="mx-3 mb-3 p-3 bg-[#111111] border border-[#1e1e1e] rounded-lg space-y-2.5"
          onClick={e => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-[#555] uppercase tracking-wider mb-1">Assignee</p>
              {task.assignee ? (
                <div className="flex items-center gap-1.5">
                  <Avatar name={task.assignee.name} color={task.assignee.avatar_color} size="sm" avatarUrl={task.assignee.avatar_url} />
                  <span className="text-xs text-[#ccc]">{task.assignee.name}</span>
                </div>
              ) : <span className="text-xs text-[#555]">—</span>}
            </div>
            <div>
              <p className="text-[10px] text-[#555] uppercase tracking-wider mb-1">Due Date</p>
              <span className={cn('text-xs', overdue ? 'text-[#ff3c00]' : 'text-[#ccc]')}>
                {task.due_date ? formatDate(task.due_date) : '—'}
              </span>
            </div>
          </div>
          {task.requires_approval && task.approver && (
            <div>
              <p className="text-[10px] text-[#555] uppercase tracking-wider mb-1">Approver</p>
              <div className="flex items-center gap-1.5">
                <Avatar name={task.approver.name} color={task.approver.avatar_color} size="sm" avatarUrl={task.approver.avatar_url} />
                <span className="text-xs text-[#ccc]">{task.approver.name}</span>
              </div>
            </div>
          )}
          {showFootageLink && (
            <div>
              <p className="text-[10px] text-[#555] uppercase tracking-wider mb-1">Footage</p>
              <a
                href={episode.footage_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#f7931a] hover:text-[#e07d10] transition-colors"
                onClick={e => e.stopPropagation()}
              >
                {getDomain(episode.footage_url!)} →
              </a>
            </div>
          )}
          {task.note && (
            <div>
              <p className="text-[10px] text-[#555] uppercase tracking-wider mb-1">Note</p>
              <p className="text-xs text-[#ff9980] leading-relaxed">{task.note}</p>
            </div>
          )}
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="mx-3 mb-2 px-2 py-1.5 bg-[#ff3c00]/10 border border-[#ff3c00]/30 rounded text-[10px] text-[#ff9980]" onClick={e => e.stopPropagation()}>
          {actionError}
        </div>
      )}

      {/* Date edit inline */}
      {editingDate && !isLocked && (
        <div className="px-3 pb-3 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <input
            ref={inputRef}
            type="datetime-local"
            value={dateValue}
            onChange={e => setDateValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitDate()
              if (e.key === 'Escape') { setDateValue(toDatetimeLocal(task.due_date)); setEditingDate(false) }
            }}
            className="flex-1 px-2 py-0.5 bg-[#1e1e1e] border border-[#ff3c00]/60 text-white rounded text-xs focus:outline-none"
          />
          <button onClick={commitDate} className="p-0.5 rounded bg-[#ff3c00] text-white shrink-0">
            <Check className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Date edit pencil (admin/manager, hover) */}
      {canEditDates && !isLocked && !editingDate && (
        <button
          onClick={e => { e.stopPropagation(); setEditingDate(true) }}
          className="absolute top-3 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[#2e2e2e] text-[#555] hover:text-white transition-all z-10"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  )
}

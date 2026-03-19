'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Lock, AlertCircle, Pencil, Check, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Episode, Task, User, Track, TaskStatus, canEditDates as canEditDatesRole, canApprove } from '@/lib/types'
import { StatusBadge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { TaskModal } from '@/components/tasks/TaskModal'
import { cn, formatDate, isOverdue, toDatetimeLocal, fromDatetimeLocal } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { parseISO, format } from 'date-fns'

interface TaskComment { count: number; latest: string }

interface Props {
  currentUser: User
  episode: Episode
  initialTasks: Task[]
  taskComments: Record<string, TaskComment>
}

const TRACK_ORDER: Track[] = ['Long-form', 'Trailer', 'Thumbnails', 'Clips & Shorts', 'Review', 'Publishing']

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

// ─── Timeline dot ────────────────────────────────────────────────────────────

function TimelineDot({ status }: { status: TaskStatus }) {
  const prevStatus = useRef(status)
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    if (prevStatus.current !== status && (status === 'approved' || status === 'done')) {
      setAnimating(true)
      const t = setTimeout(() => setAnimating(false), 800)
      return () => clearTimeout(t)
    }
    prevStatus.current = status
  }, [status])

  const color =
    status === 'in_review'  ? 'bg-yellow-400' :
    status === 'approved' || status === 'done' || status === 'locked' ? 'bg-[#333]' :
    'bg-[#ff3c00]' // ready, in_progress, revision

  return (
    <div className={cn('w-2 h-2 rounded-full relative z-10', color, animating && 'dot-complete')} />
  )
}

// ─── Project timeline sidebar ─────────────────────────────────────────────────

function ProjectTimeline({ tracks, tasks }: { tracks: Track[]; tasks: Task[] }) {
  return (
    <div className="w-5 shrink-0 sticky top-28 self-start">
      <div className="relative flex flex-col gap-4">
        {/* Vertical line spanning full height */}
        <div className="absolute left-1/2 -translate-x-1/2 top-[58px] bottom-5 w-px bg-[#252525]" />

        {tracks.map(track => {
          const trackTasks = tasks.filter(t => t.track === track)
          return (
            <div key={track}>
              {/* Spacer matching track header h-8 + mb-1.5 */}
              <div className="h-[38px]" />
              {trackTasks.map(task => (
                <div key={task.id} className="h-10 flex items-center justify-center">
                  <TimelineDot status={task.status} />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main client ──────────────────────────────────────────────────────────────

export function EpisodeDetailClient({ currentUser, episode, initialTasks, taskComments }: Props) {
  const supabase = createClient()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const canEditDates = canEditDatesRole(currentUser)
  const canEdit = canApprove(currentUser)

  useEffect(() => {
    const channel = supabase
      .channel(`episode-${episode.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `episode_id=eq.${episode.id}` },
        (payload) => {
          setTasks(prev => prev.map(t => t.id === payload.new.id ? { ...t, ...payload.new } : t))
          setSelectedTask(prev => prev?.id === payload.new.id ? { ...prev, ...payload.new } as Task : prev)
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [episode.id])

  function handleTaskUpdate(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t))
    setSelectedTask(updated)
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

  const tracks = TRACK_ORDER.filter(track => tasks.some(t => t.track === track))

  const daysUntil = Math.round(
    (parseISO(episode.release_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div className="max-w-5xl space-y-4">
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
            <span className="text-sm text-[#888] font-medium">{episode.client_label}</span>
            <span className="text-[#444]">·</span>
            <span className={cn('text-sm font-medium',
              daysUntil < 0 ? 'text-[#ff3c00]' : daysUntil < 3 ? 'text-yellow-500' : 'text-[#888]'
            )}>
              {daysUntil < 0 ? `Released ${Math.abs(daysUntil)}d ago` :
               daysUntil === 0 ? 'Releases today' :
               `Releases in ${daysUntil}d · ${format(parseISO(episode.release_date), 'MMM d, yyyy')}`}
            </span>
          </div>
          <h1 className="text-2xl font-black text-white">{episode.guest_name}</h1>
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
      />

      {/* Two-column: task list + timeline */}
      <div className="flex items-start gap-4">

        {/* Task list */}
        <div className="flex-1 min-w-0 space-y-4">
          {tracks.map(track => {
            const trackTasks = tasks.filter(t => t.track === track)
            const trackColor = TRACK_COLORS[track]
            const done = trackTasks.filter(t => t.status === 'approved' || t.status === 'done').length

            return (
              <div key={track}>
                <div className="h-8 flex items-center gap-2 mb-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: trackColor }} />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wide">{track}</h2>
                  <span className="text-xs text-[#555]">{done}/{trackTasks.length}</span>
                </div>
                <div className="border border-[#2e2e2e] rounded-lg overflow-hidden divide-y divide-[#242424]">
                  {trackTasks.map(task => (
                    <EpisodeTaskRow
                      key={task.id}
                      task={task}
                      canEditDates={canEditDates}
                      taskComment={taskComments[task.id] || null}
                      onDateChange={(oldDate, newDate) => handleDateChange(task.id, oldDate, newDate)}
                      onClick={() => setSelectedTask(task)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Timeline sidebar */}
        <ProjectTimeline tracks={tracks} tasks={tasks} />
      </div>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          currentUser={currentUser}
          episode={episode}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdate}
        />
      )}
    </div>
  )
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function BriefNotes({ episodeId, initialNotes, canEdit }: {
  episodeId: string
  initialNotes: string | null
  canEdit: boolean
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
    <div className="bg-[#1e1e1e] border border-[#2e2e2e] rounded-xl p-4 space-y-2">
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
            className="w-full bg-[#141414] border border-[#333] rounded-lg px-3 py-2 text-sm text-[#ccc] resize-none focus:outline-none focus:ring-1 focus:ring-[#ff3c00] placeholder-[#444] leading-relaxed"
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
              className="px-4 py-1.5 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-[#ccc] whitespace-pre-wrap leading-relaxed">
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
        </div>
      )}
    </div>
  )
}

// ─── Task row ─────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: Task
  canEditDates: boolean
  taskComment: TaskComment | null
  onDateChange: (oldDate: string | null, newDate: string) => void
  onClick: () => void
}

function EpisodeTaskRow({ task, canEditDates, taskComment, onDateChange, onClick }: TaskRowProps) {
  const isLocked = task.status === 'locked'
  const overdue = isOverdue(task.due_date, task.status)
  const [editingDate, setEditingDate] = useState(false)
  const [dateValue, setDateValue] = useState(toDatetimeLocal(task.due_date))
  const inputRef = useRef<HTMLInputElement>(null)

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

  function handleDateKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitDate()
    if (e.key === 'Escape') { setDateValue(toDatetimeLocal(task.due_date)); setEditingDate(false) }
  }

  const showDateEdit = canEditDates && !isLocked
  const commentPreview = taskComment
    ? taskComment.latest.length > 32 ? taskComment.latest.slice(0, 32) + '…' : taskComment.latest
    : null

  return (
    <div className={cn(
      'h-10 flex items-center gap-3 px-3 transition-colors',
      isLocked ? 'opacity-35 bg-[#101010]' : overdue ? 'bg-[#ff3c00]/5 hover:bg-[#ff3c00]/8' : 'bg-[#141414] hover:bg-[#242424]'
    )}>
      {/* Label — aggressively bigger */}
      <button onClick={onClick} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
        {isLocked
          ? <Lock className="w-3 h-3 text-[#444] shrink-0" />
          : <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', overdue ? 'bg-[#ff3c00]' : 'bg-[#2e2e2e]')} />
        }
        <span className={cn(
          'text-base font-semibold truncate leading-none',
          isLocked ? 'text-[#555]' : overdue ? 'text-white' : 'text-[#e0e0e0]'
        )}>
          {task.label}
        </span>
      </button>

      {/* Right side */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Comment bubble */}
        {taskComment && commentPreview && (
          <button
            onClick={onClick}
            className="flex items-center gap-1.5 bg-[#232323] border border-[#2e2e2e] rounded-full px-2 py-0.5 max-w-[200px] hover:border-[#2e2e2e] transition-colors"
          >
            <MessageSquare className="w-3 h-3 text-[#ff3c00] shrink-0" />
            <span className="text-xs text-[#666] shrink-0 font-medium">{taskComment.count}</span>
            <span className="text-[#2e2e2e] text-xs shrink-0">·</span>
            <span className="text-xs text-[#555] truncate">{commentPreview}</span>
          </button>
        )}

        {overdue && !isLocked && <AlertCircle className="w-3.5 h-3.5 text-[#ff3c00]" />}

        {/* Date */}
        {!isLocked && (
          editingDate ? (
            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="datetime-local"
                value={dateValue}
                onChange={e => setDateValue(e.target.value)}
                onKeyDown={handleDateKeyDown}
                className="px-2 py-0.5 bg-[#1e1e1e] border border-[#ff3c00]/60 text-white rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#ff3c00]"
              />
              <button onClick={commitDate} className="p-0.5 rounded bg-[#ff3c00] hover:bg-[#e63600] text-white">
                <Check className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 group/date">
              {task.due_date && (
                <span className={cn('text-xs tabular-nums', overdue ? 'text-[#ff3c00]' : 'text-[#555]')}>
                  {formatDate(task.due_date)}
                </span>
              )}
              {showDateEdit && (
                <button
                  onClick={e => { e.stopPropagation(); setEditingDate(true) }}
                  className="p-0.5 rounded opacity-0 group-hover/date:opacity-100 hover:bg-[#1e1e1e] text-[#555] hover:text-white transition-all"
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )
        )}

        <button onClick={onClick}>
          <StatusBadge status={task.status} />
        </button>
        {task.assignee && (
          <button onClick={onClick}>
            <Avatar name={task.assignee.name} color={task.assignee.avatar_color} size="sm" />
          </button>
        )}
      </div>
    </div>
  )
}

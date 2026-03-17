'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Lock, AlertCircle, Pencil, Check, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Episode, Task, User, Track, TaskStatus } from '@/lib/types'
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

  const canEditDates = currentUser.role === 'admin' || currentUser.name === 'Ali'

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
          className="p-1.5 rounded-md hover:bg-[#2a2a2a] text-[#888] shrink-0"
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
        </div>
        {episode.footage_url && (
          <a
            href={episode.footage_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2a2a2a] hover:bg-[#333] text-[#ccc] rounded-lg text-sm font-medium transition-colors shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />Footage
          </a>
        )}
      </div>

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
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdate}
        />
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
      isLocked ? 'opacity-35 bg-[#191919]' : overdue ? 'bg-[#ff3c00]/5 hover:bg-[#ff3c00]/8' : 'bg-[#1e1e1e] hover:bg-[#242424]'
    )}>
      {/* Label — aggressively bigger */}
      <button onClick={onClick} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
        {isLocked
          ? <Lock className="w-3 h-3 text-[#444] shrink-0" />
          : <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', overdue ? 'bg-[#ff3c00]' : 'bg-[#3a3a3a]')} />
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
            className="flex items-center gap-1.5 bg-[#232323] border border-[#2e2e2e] rounded-full px-2 py-0.5 max-w-[200px] hover:border-[#3a3a3a] transition-colors"
          >
            <MessageSquare className="w-3 h-3 text-[#ff3c00] shrink-0" />
            <span className="text-xs text-[#666] shrink-0 font-medium">{taskComment.count}</span>
            <span className="text-[#3a3a3a] text-xs shrink-0">·</span>
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
                className="px-2 py-0.5 bg-[#2a2a2a] border border-[#ff3c00]/60 text-white rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#ff3c00]"
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
                  className="p-0.5 rounded opacity-0 group-hover/date:opacity-100 hover:bg-[#2a2a2a] text-[#555] hover:text-white transition-all"
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

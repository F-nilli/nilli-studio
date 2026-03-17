'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Lock, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Episode, Task, User, Track } from '@/lib/types'
import { StatusBadge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { TaskModal } from '@/components/tasks/TaskModal'
import { cn, formatDate, isOverdue } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { parseISO, format } from 'date-fns'

interface Props {
  currentUser: User
  episode: Episode
  initialTasks: Task[]
}

const TRACK_ORDER: Track[] = ['Long-form', 'Trailer', 'Thumbnails', 'Clips & Shorts', 'Review', 'Publishing']

export function EpisodeDetailClient({ currentUser, episode, initialTasks }: Props) {
  const supabase = createClient()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

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

  const tracks = TRACK_ORDER.filter(track => tasks.some(t => t.track === track))

  const daysUntil = Math.round(
    (parseISO(episode.release_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          href={currentUser.role === 'admin' ? '/board' : '/dashboard'}
          className="p-2 rounded-md hover:bg-[#2a2a2a] text-[#888] mt-0.5 shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base text-[#888] font-medium">{episode.client_label}</span>
            <span className="text-[#444]">·</span>
            <span className={cn('text-base font-medium',
              daysUntil < 0 ? 'text-[#ff3c00]' : daysUntil < 3 ? 'text-yellow-500' : 'text-[#888]'
            )}>
              {daysUntil < 0 ? `Released ${Math.abs(daysUntil)}d ago` :
               daysUntil === 0 ? 'Releases today' :
               `Releases in ${daysUntil}d · ${format(parseISO(episode.release_date), 'MMM d, yyyy')}`}
            </span>
          </div>
          <h1 className="text-3xl font-black text-white mt-1">{episode.guest_name}</h1>
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

      <div className="space-y-6">
        {tracks.map(track => {
          const trackTasks = tasks.filter(t => t.track === track)
          const trackColor = TRACK_COLORS[track]
          const done = trackTasks.filter(t => t.status === 'approved' || t.status === 'done').length

          return (
            <div key={track}>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: trackColor }} />
                <h2 className="text-base font-bold text-white">{track}</h2>
                <span className="text-sm text-[#666]">{done}/{trackTasks.length}</span>
              </div>
              <div className="space-y-2">
                {trackTasks.map(task => (
                  <EpisodeTaskRow key={task.id} task={task} onClick={() => setSelectedTask(task)} />
                ))}
              </div>
            </div>
          )
        })}
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

function EpisodeTaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const isLocked = task.status === 'locked'
  const overdue = isOverdue(task.due_date, task.status)

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border px-4 py-3 transition-all',
        isLocked
          ? 'opacity-40 bg-[#1a1a1a] border-[#2e2e2e] cursor-default'
          : overdue
          ? 'bg-[#1e1e1e] border-[#ff3c00]/40 hover:border-[#ff3c00]/70'
          : 'bg-[#1e1e1e] border-[#2e2e2e] hover:border-[#444]'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {isLocked && <Lock className="w-3.5 h-3.5 text-[#555] shrink-0" />}
          <p className={cn('text-base font-medium truncate', isLocked ? 'text-[#555]' : 'text-white')}>
            {task.label}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {overdue && !isLocked && <AlertCircle className="w-4 h-4 text-[#ff3c00]" />}
          {task.due_date && !isLocked && (
            <span className={cn('text-sm', overdue ? 'text-[#ff3c00]' : 'text-[#666]')}>
              {formatDate(task.due_date)}
            </span>
          )}
          <StatusBadge status={task.status} />
          {task.assignee && (
            <Avatar name={task.assignee.name} color={task.assignee.avatar_color} size="sm" />
          )}
        </div>
      </div>
    </button>
  )
}

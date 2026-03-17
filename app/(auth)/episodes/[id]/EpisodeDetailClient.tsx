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

  // Real-time task updates
  useEffect(() => {
    const channel = supabase
      .channel(`episode-${episode.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'tasks',
        filter: `episode_id=eq.${episode.id}`,
      }, (payload) => {
        setTasks(prev => prev.map(t =>
          t.id === payload.new.id ? { ...t, ...payload.new } : t
        ))
        setSelectedTask(prev =>
          prev?.id === payload.new.id ? { ...prev, ...payload.new } as Task : prev
        )
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [episode.id])

  function handleTaskUpdate(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t))
    setSelectedTask(updated)
  }

  // Group tasks by track
  const tracks = TRACK_ORDER.filter(track =>
    tasks.some(t => t.track === track)
  )

  const daysUntil = Math.round(
    (parseISO(episode.release_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link
          href={currentUser.role === 'admin' ? '/board' : '/dashboard'}
          className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 mt-0.5 shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">{episode.client_label}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className={cn(
              'text-sm font-medium',
              daysUntil < 0 ? 'text-red-500' :
              daysUntil < 3 ? 'text-yellow-500' :
              'text-gray-500 dark:text-gray-400'
            )}>
              {daysUntil < 0 ? `Released ${Math.abs(daysUntil)}d ago` :
               daysUntil === 0 ? 'Releases today' :
               `Releases in ${daysUntil}d · ${format(parseISO(episode.release_date), 'MMM d, yyyy')}`}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{episode.guest_name}</h1>
        </div>
        {episode.footage_url && (
          <a
            href={episode.footage_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Footage
          </a>
        )}
      </div>

      {/* Tracks */}
      <div className="space-y-6">
        {tracks.map(track => {
          const trackTasks = tasks.filter(t => t.track === track)
          const trackColor = TRACK_COLORS[track]

          return (
            <div key={track}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ backgroundColor: trackColor }}
                />
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{track}</h2>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {trackTasks.filter(t => t.status === 'approved' || t.status === 'done').length}/{trackTasks.length}
                </span>
              </div>

              <div className="space-y-2">
                {trackTasks.map(task => (
                  <EpisodeTaskRow
                    key={task.id}
                    task={task}
                    currentUser={currentUser}
                    onClick={() => setSelectedTask(task)}
                  />
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

function EpisodeTaskRow({
  task,
  currentUser,
  onClick,
}: {
  task: Task
  currentUser: User
  onClick: () => void
}) {
  const isLocked = task.status === 'locked'
  const overdue = isOverdue(task.due_date, task.status)

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border px-4 py-3 transition-all group',
        isLocked
          ? 'opacity-50 bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-800 cursor-default'
          : overdue
          ? 'bg-white dark:bg-gray-900 border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700'
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {isLocked && <Lock className="w-3.5 h-3.5 text-gray-400 shrink-0" />}

          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-base font-medium truncate',
              isLocked ? 'text-gray-500 dark:text-gray-500' : 'text-gray-900 dark:text-white'
            )}>
              {task.label}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {overdue && !isLocked && (
            <AlertCircle className="w-4 h-4 text-red-500" />
          )}

          {task.due_date && !isLocked && (
            <span className={cn('text-xs', overdue ? 'text-red-500' : 'text-gray-400 dark:text-gray-500')}>
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

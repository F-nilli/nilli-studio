'use client'

import { useState, useEffect, useRef } from 'react'
import { Check, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import { sendNotification } from '@/lib/notifications'
import type { Task, User, Episode } from '@/lib/types'

interface Props {
  task: Task
  currentUser: User
  episode: Episode
  onReassigned: (updatedTask: Task, toast: string) => void
  onClose: () => void
}

const ACTIVE_STATUSES = ['ready', 'in_progress', 'in_review', 'revision']

export function ReassignDropdown({ task, currentUser, episode, onReassigned, onClose }: Props) {
  const supabase = createClient()
  const [users, setUsers] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('users').select('*').then(({ data }) => {
      if (data) setUsers((data as User[]).filter(u => u.active !== false))
    })
  }, [])

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  const filtered = users
    .filter(u => u.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (a.id === task.assignee_id) return -1
      if (b.id === task.assignee_id) return 1
      return a.name.localeCompare(b.name)
    })

  async function handleSelect(newAssignee: User) {
    if (newAssignee.id === task.assignee_id || savingId) return
    const oldAssignee = task.assignee as User | undefined
    setSavingId(newAssignee.id)

    const { data, error } = await supabase
      .from('tasks')
      .update({ assignee_id: newAssignee.id })
      .eq('id', task.id)
      .select('*')
      .single()

    if (error || !data) {
      console.error('Reassign error:', error)
      setSavingId(null)
      return
    }

    // Audit trail
    supabase.from('task_history').insert({
      task_id: task.id,
      episode_id: task.episode_id,
      from_status: task.status,
      to_status: task.status,
      changed_by: currentUser.id,
      note: `Reassigned from ${oldAssignee?.name ?? '—'} to ${newAssignee.name}`,
    }).then(() => {})

    if (ACTIVE_STATUSES.includes(task.status)) {
      // Notify new assignee
      sendNotification(supabase, {
        userId: newAssignee.id,
        type: 'task_unlocked',
        title: 'Task assigned to you',
        body: `You've been assigned to "${task.label}" — ${episode.guest_name} / ${episode.client_label}`,
        taskId: task.id,
        episodeId: task.episode_id,
      }).catch(() => {})

      // Notify old assignee (in-app only)
      if (oldAssignee && oldAssignee.id !== currentUser.id && oldAssignee.id !== newAssignee.id) {
        sendNotification(supabase, {
          userId: oldAssignee.id,
          type: 'task_unlocked',
          title: 'Task reassigned',
          body: `"${task.label}" has been reassigned to ${newAssignee.name} by ${currentUser.name}`,
          taskId: task.id,
          episodeId: task.episode_id,
        }).catch(() => {})
      }

      // Slack to client channel
      fetch('/api/slack/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'reassign',
          episodeId: task.episode_id,
          taskLabel: task.label,
          fromName: currentUser.name,
          toName: newAssignee.name,
        }),
      }).catch(err => console.error('[Slack]', err))
    }

    const toast = task.status === 'locked'
      ? `Task reassigned to ${newAssignee.name} — they'll be notified when it unlocks`
      : `Task reassigned to ${newAssignee.name}`

    onReassigned(
      { ...data, assignee: newAssignee } as unknown as Task,
      toast
    )
  }

  return (
    <div
      ref={containerRef}
      className="mt-1.5 rounded-lg overflow-hidden"
      style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="p-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#141414] rounded border border-[#2e2e2e]">
          <Search className="w-3 h-3 text-[#555] shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search teammates…"
            className="flex-1 bg-transparent text-xs text-white placeholder-[#444] focus:outline-none"
          />
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-3 py-3 text-xs text-[#555] text-center">No matches</p>
        )}
        {filtered.map(user => {
          const isCurrent = user.id === task.assignee_id
          const isSaving = savingId === user.id
          return (
            <button
              key={user.id}
              onClick={() => handleSelect(user)}
              disabled={savingId !== null}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors disabled:opacity-60',
                isCurrent ? 'bg-[#222]' : 'hover:bg-[#222] cursor-pointer'
              )}
            >
              <Avatar name={user.name} color={user.avatar_color} size="sm" avatarUrl={user.avatar_url} />
              <div className="flex-1 min-w-0">
                <span className={cn('text-xs font-medium truncate block', isCurrent ? 'text-white' : 'text-[#ccc]')}>
                  {user.name}
                </span>
                <span className="text-[10px] text-[#555] capitalize">{user.role?.replace('_', ' ')}</span>
              </div>
              {isSaving && <Spinner />}
              {isCurrent && !isSaving && (
                <>
                  <Check className="w-3 h-3 text-[#ff3c00] shrink-0" />
                  <span className="text-[10px] text-[#555]">(current)</span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

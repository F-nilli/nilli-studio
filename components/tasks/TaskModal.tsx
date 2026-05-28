'use client'

import { useState, useEffect } from 'react'
import { X, Lock, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Task, User, TaskStatus, Episode } from '@/lib/types'
import { StatusBadge, VersionBadge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { cn, formatDate, isOverdue, STATUS_LABELS } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { sendNotification, markTaskNotificationsRead } from '@/lib/notifications'
import { Spinner } from '@/components/ui/Spinner'

interface Props {
  task: Task
  currentUser: User
  onClose: () => void
  onUpdate: (task: Task) => void
  episode?: Episode
  onPendingAction?: (label: string, revert: () => void, commit: (silent: boolean) => Promise<void>) => void
}

function getDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

const FOOTAGE_TRACKS = ['Trailer', 'Clips & Shorts', 'Long-form']

const NEXT_STATUS: Partial<Record<TaskStatus, TaskStatus>> = {
  in_progress: 'in_review',
  revision: 'in_review',
}

interface DepTaskInfo {
  id: string
  label: string
  status: TaskStatus
  assignee_id: string | null
  assignee_name: string | null
  assignee_avatar_color: string | null
  assignee_avatar_url: string | null
}

export function TaskModal({ task, currentUser, onClose, onUpdate, episode, onPendingAction }: Props) {
  const supabase = createClient()
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [sendingBack, setSendingBack] = useState(false)
  const [noteText, setNoteText] = useState('')         // note for approve / submit action
  const [sendBackNote, setSendBackNote] = useState('') // note for send back action (→ assignee)
  // downstream task assignee for approve action
  const [nextUserForNote, setNextUserForNote] = useState<{ user: User; taskId: string } | null>(null)
  // dependencies for locked tasks
  const [depTasks, setDepTasks] = useState<DepTaskInfo[] | null>(null)

  const isAssignee = task.assignee_id === currentUser.id
  const isReviewer = task.requires_approval
    ? (currentUser.id === task.approver_id || currentUser.role === 'admin')
    : false
  const overdue = isOverdue(task.due_date, task.status, task.requires_approval, task.review_started_at)
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS]
  const nextStatus = NEXT_STATUS[task.status]
  const canAction = isAssignee && nextStatus !== undefined
  const canReview = isReviewer && task.status === 'in_review'

  // Eagerly determine who the note is for and where to post it
  useEffect(() => {
    setNoteText('')
    setSendBackNote('')
    setNextUserForNote(null)

    async function compute() {
      if (canAction) {
        const resolvedStatus: TaskStatus = nextStatus === 'in_review' && !task.approver_id ? 'done' : nextStatus!
        if (resolvedStatus === 'in_review' && task.approver_id && task.approver_id !== currentUser.id) {
          // Note goes to approver, on this task
          const approver = task.approver as User | undefined
          if (approver?.name) {
            setNextUserForNote({ user: approver, taskId: task.id })
          } else {
            const { data } = await supabase.from('users').select('*').eq('id', task.approver_id).single()
            if (data) setNextUserForNote({ user: data as User, taskId: task.id })
          }
        } else if (resolvedStatus === 'done') {
          // No approver — note goes to downstream unlocking task's assignee
          const { data: allTasks } = await supabase
            .from('tasks').select('id, status, dep_task_ids, assignee_id').eq('episode_id', task.episode_id)
          if (!allTasks) return
          const approvedIds = new Set([
            ...allTasks.filter(t => t.status === 'approved' || t.status === 'done').map(t => t.id),
            task.id,
          ])
          const unlocking = allTasks.find(t =>
            t.status === 'locked' && t.dep_task_ids.length > 0 &&
            t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
          )
          if (unlocking && unlocking.assignee_id !== currentUser.id) {
            const { data } = await supabase.from('users').select('*').eq('id', unlocking.assignee_id).single()
            if (data) setNextUserForNote({ user: data as User, taskId: unlocking.id })
          }
        }
      } else if (canReview) {
        // Note goes to downstream task's assignee (the task that will be unlocked by this approval)
        const { data: allTasks } = await supabase
          .from('tasks').select('id, status, dep_task_ids, assignee_id').eq('episode_id', task.episode_id)
        if (!allTasks) return
        const approvedIds = new Set([
          ...allTasks.filter(t => t.status === 'approved' || t.status === 'done').map(t => t.id),
          task.id,
        ])
        const unlocking = allTasks.find(t =>
          t.status === 'locked' && t.dep_task_ids.length > 0 &&
          t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
        )
        if (unlocking && unlocking.assignee_id !== currentUser.id) {
          const { data: assignee } = await supabase.from('users').select('*').eq('id', unlocking.assignee_id).single()
          if (assignee) setNextUserForNote({ user: assignee as User, taskId: unlocking.id })
        }
      }
    }

    compute()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.status])

  // Fetch dep tasks for locked tasks so we can show what's blocking unlock.
  useEffect(() => {
    if (task.status !== 'locked' || task.dep_task_ids.length === 0) {
      setDepTasks(null)
      return
    }
    let cancelled = false
    supabase
      .from('tasks')
      .select('id, label, status, assignee_id, assignee:users!assignee_id(name, avatar_color, avatar_url)')
      .in('id', task.dep_task_ids)
      .then(({ data }) => {
        if (cancelled || !data) return
        const flat: DepTaskInfo[] = (data as Array<{
          id: string
          label: string
          status: string
          assignee_id: string | null
          assignee?: { name: string; avatar_color: string; avatar_url: string | null } | { name: string; avatar_color: string; avatar_url: string | null }[] | null
        }>).map(d => {
          const assigneeRaw = Array.isArray(d.assignee) ? d.assignee[0] : d.assignee
          return {
            id: d.id,
            label: d.label,
            status: d.status as TaskStatus,
            assignee_id: d.assignee_id,
            assignee_name: assigneeRaw?.name ?? null,
            assignee_avatar_color: assigneeRaw?.avatar_color ?? null,
            assignee_avatar_url: assigneeRaw?.avatar_url ?? null,
          }
        })
        // Incomplete tasks first so the user sees what's still missing.
        flat.sort((a, b) => {
          const aDone = a.status === 'done' || a.status === 'approved'
          const bDone = b.status === 'done' || b.status === 'approved'
          if (aDone !== bDone) return aDone ? 1 : -1
          return a.label.localeCompare(b.label)
        })
        setDepTasks(flat)
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.status, task.dep_task_ids.join(',')])

  async function maybePostSendBackNote() {
    if (!sendBackNote.trim() || !task.assignee || task.assignee_id === currentUser.id) return
    const assignee = task.assignee as User
    const body = `→ ${assignee.name}: ${sendBackNote.trim()}`
    const { data: comment } = await supabase
      .from('comments')
      .insert({ task_id: task.id, episode_id: task.episode_id, author_id: currentUser.id, body, internal: false })
      .select('id').single()
    if (comment) {
      fetch('/api/notifications/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentId: comment.id, authorId: currentUser.id,
          taskId: task.id, episodeId: task.episode_id,
          body, assigneeId: task.assignee_id,
        }),
      }).catch(() => {})
    }
  }

  async function maybePostNote() {
    if (!noteText.trim() || !nextUserForNote) return
    const body = `→ ${nextUserForNote.user.name}: ${noteText.trim()}`
    const { data: comment } = await supabase
      .from('comments')
      .insert({ task_id: nextUserForNote.taskId, episode_id: task.episode_id, author_id: currentUser.id, body, internal: false })
      .select('id').single()
    if (comment) {
      fetch('/api/notifications/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentId: comment.id, authorId: currentUser.id,
          taskId: nextUserForNote.taskId, episodeId: task.episode_id,
          body, assigneeId: nextUserForNote.user.id,
        }),
      }).catch(() => {})
    }
  }

  async function updateStatus(newStatus: TaskStatus) {
    const resolvedStatus: TaskStatus =
      newStatus === 'in_review' && !task.approver_id ? 'done' : newStatus

    const originalTask = task
    const capturedNote = noteText
    const capturedNextUser = nextUserForNote
    const actionLabel =
      resolvedStatus === 'in_review' ? `Submitted "${task.label}" for review`
      : resolvedStatus === 'done' ? `Marked "${task.label}" as done`
      : `Updated "${task.label}"`

    onUpdate({ ...task, status: resolvedStatus } as unknown as Task)
    onClose()

    const commit = async (silent: boolean) => {
      if (!silent && capturedNote.trim() && capturedNextUser) {
        const body = `→ ${capturedNextUser.user.name}: ${capturedNote.trim()}`
        const { data: comment } = await supabase
          .from('comments')
          .insert({ task_id: capturedNextUser.taskId, episode_id: task.episode_id, author_id: currentUser.id, body, internal: false })
          .select('id').single()
        if (comment) {
          fetch('/api/notifications/comment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commentId: comment.id, authorId: currentUser.id, taskId: capturedNextUser.taskId, episodeId: task.episode_id, body, assigneeId: capturedNextUser.user.id }) }).catch(() => {})
        }
      }

      const updatePayload: Record<string, unknown> = { status: resolvedStatus }
      if (resolvedStatus === 'in_review') updatePayload.review_started_at = new Date().toISOString()
      const { data, error } = await supabase.from('tasks').update(updatePayload).eq('id', task.id).select('*').single()
      if (error || !data) { onUpdate(originalTask); return }

      // Auto-clear my own action-required notifications for this task.
      markTaskNotificationsRead(supabase, currentUser.id, task.id).catch(() => {})
      supabase.from('task_history').insert({ task_id: task.id, episode_id: task.episode_id, from_status: task.status, to_status: resolvedStatus, changed_by: currentUser.id }).then(() => {})
      onUpdate(data as unknown as Task)

      if (!silent && resolvedStatus === 'in_review' && task.approver_id && task.approver_id !== currentUser.id) {
        const nextVersion = (task.submission_count ?? 0) + 1
        const versionTag = nextVersion > 0 ? ` (v${nextVersion})` : ''
        sendNotification(supabase, { userId: task.approver_id, type: 'task_submitted_review', title: 'Task submitted for review', body: `${currentUser.name} submitted "${task.label}"${versionTag} for review`, taskId: task.id, episodeId: task.episode_id }).catch(() => {})
        fetch('/api/slack/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'review_submitted', episodeId: task.episode_id, taskLabel: task.label, assigneeName: currentUser.name, version: nextVersion }) }).catch(() => {})
      }

      await checkAndUnlockDependencies(task.episode_id, silent)
      if (resolvedStatus === 'approved' || resolvedStatus === 'done') {
        fetch('/api/episodes/check-triggers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, episodeId: task.episode_id }) }).catch(() => {})
      }
    }

    if (onPendingAction) {
      onPendingAction(actionLabel, () => onUpdate(originalTask), commit)
    } else {
      await commit(false)
    }
  }

  async function checkAndUnlockDependencies(episodeId: string, silent = false) {
    await fetch('/api/tasks/unlock-deps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeId, silent }),
    })
  }

  async function handleApprove() {
    const originalTask = task
    const capturedNote = noteText
    const capturedNextUser = nextUserForNote

    onUpdate({ ...task, status: 'approved' } as unknown as Task)
    onClose()

    const commit = async (silent: boolean) => {
      if (!silent && capturedNote.trim() && capturedNextUser) {
        const body = `→ ${capturedNextUser.user.name}: ${capturedNote.trim()}`
        const { data: comment } = await supabase.from('comments').insert({ task_id: capturedNextUser.taskId, episode_id: task.episode_id, author_id: currentUser.id, body, internal: false }).select('id').single()
        if (comment) fetch('/api/notifications/comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commentId: comment.id, authorId: currentUser.id, taskId: capturedNextUser.taskId, episodeId: task.episode_id, body, assigneeId: capturedNextUser.user.id }) }).catch(() => {})
      }

      const { data, error } = await supabase.from('tasks').update({ status: 'approved' }).eq('id', task.id).select('*').single()
      if (error || !data) { onUpdate(originalTask); return }

      markTaskNotificationsRead(supabase, currentUser.id, task.id).catch(() => {})
      supabase.from('task_history').insert({ task_id: task.id, episode_id: task.episode_id, from_status: task.status, to_status: 'approved', changed_by: currentUser.id }).then(() => {})

      await checkAndUnlockDependencies(task.episode_id, silent)
      if (!silent && task.assignee_id !== currentUser.id) {
        sendNotification(supabase, { userId: task.assignee_id, type: 'task_approved', title: 'Task approved', body: `"${task.label}" was approved by ${currentUser.name}`, taskId: task.id, episodeId: task.episode_id }).catch(() => {})
      }
      if (!silent) {
        const { data: allTasksForSlack } = await supabase.from('tasks').select('id, label, status, dep_task_ids, assignee_id, assignee:users!assignee_id(name)').eq('episode_id', task.episode_id)
        const nextTasksForSlack: Array<{ label: string; assigneeName: string }> = []
        if (allTasksForSlack) {
          const approvedIds = new Set(allTasksForSlack.filter(t => t.status === 'approved' || t.status === 'done' || t.id === task.id).map(t => t.id))
          for (const t of allTasksForSlack) {
            if (t.status === 'locked' && t.dep_task_ids.length > 0 && t.dep_task_ids.every((d: string) => approvedIds.has(d))) {
              nextTasksForSlack.push({ label: t.label, assigneeName: (t.assignee as unknown as { name: string } | null)?.name ?? '—' })
            }
          }
        }
        fetch('/api/slack/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'approval', episodeId: task.episode_id, completedTaskLabel: task.label, nextTasks: nextTasksForSlack, approverName: task.approver_id ? currentUser.name : undefined }) }).catch(() => {})
      }
      fetch('/api/episodes/check-triggers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, episodeId: task.episode_id }) }).catch(() => {})
      onUpdate(data as unknown as Task)
    }

    if (onPendingAction) {
      onPendingAction(`Approved "${task.label}"`, () => onUpdate(originalTask), commit)
    } else {
      await commit(false)
    }
  }

  async function handleRevision() {
    const originalTask = task
    const capturedSendBackNote = sendBackNote

    onUpdate({ ...task, status: 'revision' } as unknown as Task)
    onClose()

    const commit = async (silent: boolean) => {
      if (!silent && capturedSendBackNote.trim() && task.assignee && task.assignee_id !== currentUser.id) {
        const assignee = task.assignee as User
        const body = `→ ${assignee.name}: ${capturedSendBackNote.trim()}`
        const { data: comment } = await supabase.from('comments').insert({ task_id: task.id, episode_id: task.episode_id, author_id: currentUser.id, body, internal: false }).select('id').single()
        if (comment) fetch('/api/notifications/comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commentId: comment.id, authorId: currentUser.id, taskId: task.id, episodeId: task.episode_id, body, assigneeId: task.assignee_id }) }).catch(() => {})
      }

      const { data, error } = await supabase.from('tasks').update({ status: 'revision' }).eq('id', task.id).select('*').single()
      if (error || !data) { onUpdate(originalTask); return }

      markTaskNotificationsRead(supabase, currentUser.id, task.id).catch(() => {})
      supabase.from('task_history').insert({ task_id: task.id, episode_id: task.episode_id, from_status: task.status, to_status: 'revision', changed_by: currentUser.id }).then(() => {})
      if (!silent) {
        const { data: assignee } = await supabase.from('users').select('*').eq('id', task.assignee_id).single()
        if (assignee) {
          sendNotification(supabase, { userId: assignee.id, type: 'task_revision', title: 'Task sent back for revision', body: `"${task.label}" was sent back for revision by ${currentUser.name}`, taskId: task.id, episodeId: task.episode_id }).catch(() => {})
          fetch('/api/slack/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'revision', episodeId: task.episode_id, taskLabel: task.label, assigneeName: assignee.name }) }).catch(() => {})
        }
      }
      onUpdate(data as unknown as Task)
    }

    if (onPendingAction) {
      onPendingAction(`Sent back "${task.label}" for revision`, () => onUpdate(originalTask), commit)
    } else {
      await commit(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div
          className="w-full sm:max-w-2xl sm:rounded-xl rounded-t-xl max-h-[90vh] flex flex-col"
          style={{ background: '#222222', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 25px 60px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05) inset' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: trackColor }} />
                <span className="text-sm font-medium text-[#888]">{task.track}</span>
                <StatusBadge status={task.status} />
                <VersionBadge version={task.submission_count} />
                {overdue && (
                  <span className="flex items-center gap-1 text-sm text-[#ff3c00]">
                    <AlertCircle className="w-3 h-3" />Overdue
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-white leading-snug">{task.label}</h2>
              {episode && (
                <p className="text-sm text-[#555] mt-1">{episode.client_label} — {episode.guest_name}</p>
              )}
            </div>
            <button onClick={onClose} className="ml-4 p-1 rounded-md hover:bg-[#1e1e1e] text-[#888]">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-[#888] mb-1">Assignee</p>
                {task.assignee && (
                  <div className="flex items-center gap-2">
                    <Avatar name={task.assignee.name} color={task.assignee.avatar_color} size="sm" avatarUrl={task.assignee.avatar_url} />
                    <span className="text-white font-medium">{task.assignee.name}</span>
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-[#888] mb-1">Due Date</p>
                <p className={cn('font-medium text-sm', overdue ? 'text-[#ff3c00]' : 'text-white')}>
                  {formatDate(task.due_date)}
                </p>
              </div>
            </div>

            {episode?.footage_url && FOOTAGE_TRACKS.includes(task.track) && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#888]">Footage</p>
                <a
                  href={episode.footage_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-[#f7931a] hover:text-[#e07d10] transition-colors"
                >
                  {getDomain(episode.footage_url)} →
                </a>
              </div>
            )}

            {task.note && (
              <div className="border border-[#ff3c00]/15 rounded-lg p-3" style={{ background: 'linear-gradient(135deg, rgba(255,60,0,0.1), rgba(255,60,0,0.04))' }}>
                <p className="text-base text-[#ff9980]">{task.note}</p>
              </div>
            )}

            {task.status === 'locked' && (
              <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg p-3 space-y-2.5">
                <div className="flex items-center gap-2 text-sm text-[#888]">
                  <Lock className="w-4 h-4" />
                  <span>
                    Waiting on{' '}
                    {depTasks
                      ? `${depTasks.filter(d => d.status !== 'done' && d.status !== 'approved').length} of ${depTasks.length} task${depTasks.length === 1 ? '' : 's'}`
                      : 'dependencies'}
                  </span>
                </div>
                {depTasks && depTasks.length > 0 && (
                  <ul className="space-y-1.5">
                    {depTasks.map(d => {
                      const done = d.status === 'done' || d.status === 'approved'
                      return (
                        <li
                          key={d.id}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded-md"
                          style={{
                            background: done ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${done ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)'}`,
                          }}
                        >
                          {d.assignee_name && (
                            <Avatar
                              name={d.assignee_name}
                              color={d.assignee_avatar_color || '#444'}
                              avatarUrl={d.assignee_avatar_url}
                              size="sm"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={cn('text-sm truncate', done ? 'text-[#666] line-through' : 'text-[#ccc]')}>
                              {d.label}
                            </p>
                            {d.assignee_name && (
                              <p className="text-[11px] text-[#555] truncate">{d.assignee_name}</p>
                            )}
                          </div>
                          <StatusBadge status={d.status} />
                        </li>
                      )
                    })}
                  </ul>
                )}
                {!depTasks && task.dep_task_ids.length > 0 && (
                  <p className="text-[12px] text-[#555]">Loading dependencies…</p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t p-4 space-y-3" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>

            {/* Assignee action: single note for approver */}
            {canAction && nextUserForNote && (
              <NoteField
                user={nextUserForNote.user}
                value={noteText}
                onChange={setNoteText}
              />
            )}

            {canAction && (
              <button
                onClick={() => updateStatus(nextStatus!)}
                className="btn-primary w-full py-2.5 px-4 cursor-pointer text-white font-semibold rounded-lg text-base"
              >
                {task.status === 'in_progress'
                  ? (task.approver_id ? 'Submit for Review' : 'Mark Done')
                  : task.status === 'revision' ? 'Resubmit for Review'
                  : `Mark as ${STATUS_LABELS[nextStatus!]}`}
              </button>
            )}

            {/* Reviewer: two note fields aligned above their respective buttons */}
            {canReview && (task.assignee || nextUserForNote) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {task.assignee && task.assignee_id !== currentUser.id ? (
                  <NoteField
                    user={task.assignee as User}
                    value={sendBackNote}
                    onChange={setSendBackNote}
                  />
                ) : <div />}
                {nextUserForNote ? (
                  <NoteField
                    user={nextUserForNote.user}
                    value={noteText}
                    onChange={setNoteText}
                  />
                ) : <div />}
              </div>
            )}

            {canReview && (
              <div className="flex gap-2">
                <button
                  onClick={handleRevision}
                  className="flex-1 py-2.5 px-4 bg-[#1a1a1a] hover:bg-[#222] border border-[#ff3c00]/30 hover:border-[#ff3c00]/60 text-[#ff6644] font-semibold rounded-lg text-base transition-colors cursor-pointer"
                >
                  Send Back
                </button>
                <button
                  onClick={handleApprove}
                  className="btn-green flex-1 py-2.5 px-4 text-white font-semibold rounded-lg text-base cursor-pointer"
                >
                  Approve
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function NoteField({ user, value, onChange }: { user: User; value: string; onChange: (v: string) => void }) {
  const firstName = user.name.split(' ')[0]
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Avatar name={user.name} color={user.avatar_color} size="sm" avatarUrl={user.avatar_url} />
        <span className="text-xs text-[#666]">
          Note for <span className="text-[#aaa] font-medium">{firstName}</span>{' '}
          <span className="text-[#444]">(optional)</span>
        </span>
      </div>
      <textarea
        value={value}
        onChange={e => { if (e.target.value.length <= 300) onChange(e.target.value) }}
        placeholder={`Note for ${firstName}…`}
        rows={2}
        className="w-full px-2.5 py-2 bg-[#141414] border border-[#2e2e2e] rounded-lg text-sm text-white placeholder-[#444] resize-none focus:outline-none focus:ring-1 focus:ring-[#ff3c00] leading-relaxed"
      />
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { X, Lock, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Task, User, TaskStatus, Episode } from '@/lib/types'
import { StatusBadge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { cn, formatDate, isOverdue, STATUS_LABELS } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { sendNotification } from '@/lib/notifications'
import { Spinner } from '@/components/ui/Spinner'

interface Props {
  task: Task
  currentUser: User
  onClose: () => void
  onUpdate: (task: Task) => void
  episode?: Episode
}

function getDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

const FOOTAGE_TRACKS = ['Trailer', 'Clips & Shorts', 'Long-form']

const NEXT_STATUS: Partial<Record<TaskStatus, TaskStatus>> = {
  in_progress: 'in_review',
  revision: 'in_review',
}

export function TaskModal({ task, currentUser, onClose, onUpdate, episode }: Props) {
  const supabase = createClient()
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [sendingBack, setSendingBack] = useState(false)
  const [noteText, setNoteText] = useState('')         // note for approve / submit action
  const [sendBackNote, setSendBackNote] = useState('') // note for send back action (→ assignee)
  // downstream task assignee for approve action
  const [nextUserForNote, setNextUserForNote] = useState<{ user: User; taskId: string } | null>(null)

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
        }
        // For 'done' with no approver — no downstream note shown here (rare path)
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

    if (resolvedStatus === 'in_review' && task.approver_id && task.approver_id !== currentUser.id) {
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

    setUpdatingStatus(true)
    await maybePostNote()

    const updatePayload: Record<string, unknown> = { status: resolvedStatus }
    if (resolvedStatus === 'in_review') updatePayload.review_started_at = new Date().toISOString()
    const { data, error } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', task.id)
      .select('*')
      .single()

    if (error || !data) {
      console.error('Task update error:', error)
      setUpdatingStatus(false)
      return
    }

    supabase.from('task_history').insert({
      task_id: task.id, episode_id: task.episode_id,
      from_status: task.status, to_status: resolvedStatus,
      changed_by: currentUser.id,
    }).then(() => {})
    onUpdate(data as unknown as Task)
    await checkAndUnlockDependencies(task.episode_id)
    if (resolvedStatus === 'approved' || resolvedStatus === 'done') {
      fetch('/api/episodes/check-triggers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, episodeId: task.episode_id }),
      }).catch(() => {})
    }
    setUpdatingStatus(false)
  }

  async function checkAndUnlockDependencies(episodeId: string) {
    const { data: allTasks } = await supabase.from('tasks').select('*').eq('episode_id', episodeId)
    if (!allTasks) return
    const approvedIds = new Set(allTasks.filter(t => t.status === 'approved' || t.status === 'done').map(t => t.id))
    for (const t of allTasks) {
      if (t.status === 'locked' && t.dep_task_ids.length > 0) {
        const allDepsApproved = t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
        if (allDepsApproved) {
          await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', t.id)
          const { data: assignee } = await supabase.from('users').select('*').eq('id', t.assignee_id).single()
          if (assignee) {
            const { data: ep } = await supabase.from('episodes').select('*').eq('id', episodeId).single()
            await sendNotification(supabase, {
              userId: assignee.id, type: 'task_unlocked',
              title: 'New task started',
              body: `"${t.label}" is now in progress for ${ep ? `${ep.guest_name} / ${ep.client_label}` : ''}`,
              taskId: t.id, episodeId,
            })
          }
        }
      }
    }
  }

  async function handleApprove() {
    setUpdatingStatus(true)
    await maybePostNote()

    const { data, error } = await supabase
      .from('tasks').update({ status: 'approved' }).eq('id', task.id)
      .select('*').single()

    if (error || !data) {
      console.error('Approve error:', error)
      setUpdatingStatus(false)
      return
    }

    supabase.from('task_history').insert({
      task_id: task.id, episode_id: task.episode_id,
      from_status: task.status, to_status: 'approved',
      changed_by: currentUser.id,
    }).then(() => {})
    await checkAndUnlockDependencies(task.episode_id)
    if (task.assignee_id !== currentUser.id) {
      await sendNotification(supabase, {
        userId: task.assignee_id, type: 'task_approved',
        title: 'Task approved',
        body: `"${task.label}" was approved by ${currentUser.name}`,
        taskId: task.id, episodeId: task.episode_id,
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
    onUpdate(data as unknown as Task)
    onClose()
    setUpdatingStatus(false)
  }

  async function handleRevision() {
    setUpdatingStatus(true)
    setSendingBack(true)
    await maybePostSendBackNote()

    const { data, error } = await supabase
      .from('tasks').update({ status: 'revision' }).eq('id', task.id)
      .select('*').single()

    if (error || !data) {
      console.error('Send back error:', error)
      setUpdatingStatus(false)
      setSendingBack(false)
      return
    }

    supabase.from('task_history').insert({
      task_id: task.id, episode_id: task.episode_id,
      from_status: task.status, to_status: 'revision',
      changed_by: currentUser.id,
    }).then(() => {})
    const { data: assignee } = await supabase.from('users').select('*').eq('id', task.assignee_id).single()
    if (assignee) {
      await sendNotification(supabase, {
        userId: assignee.id, type: 'task_revision',
        title: 'Task sent back for revision',
        body: `"${task.label}" was sent back for revision by ${currentUser.name}`,
        taskId: task.id, episodeId: task.episode_id,
      })
      fetch('/api/slack/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'revision', episodeId: task.episode_id, taskLabel: task.label, assigneeName: assignee.name }),
      }).catch(() => {})
    }
    onUpdate(data as unknown as Task)
    onClose()
    setUpdatingStatus(false)
    setSendingBack(false)
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
                {overdue && (
                  <span className="flex items-center gap-1 text-sm text-[#ff3c00]">
                    <AlertCircle className="w-3 h-3" />Overdue
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold text-white leading-snug">{task.label}</h2>
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
              <div className="flex items-center gap-2 text-base text-[#555] bg-[#141414] border border-[#1e1e1e] rounded-lg p-3">
                <Lock className="w-4 h-4" />
                <span>Waiting for dependencies to be approved</span>
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
                disabled={updatingStatus}
                className="btn-primary w-full py-2.5 px-4 disabled:cursor-not-allowed cursor-pointer text-white font-semibold rounded-lg text-base"
              >
                {updatingStatus ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    {task.status === 'in_progress' ? (task.approver_id ? 'Submitting...' : 'Saving...') :
                     task.status === 'ready' ? 'Starting...' :
                     task.status === 'revision' ? 'Submitting...' : 'Updating...'}
                  </span>
                ) : (
                  task.status === 'in_progress'
                    ? (task.approver_id ? 'Submit for Review' : 'Mark Done')
                  : task.status === 'ready' ? 'Start Task'
                  : task.status === 'revision' ? 'Resubmit for Review'
                  : `Mark as ${STATUS_LABELS[nextStatus!]}`
                )}
              </button>
            )}

            {/* Reviewer: two note fields aligned above their respective buttons */}
            {canReview && (task.assignee || nextUserForNote) && (
              <div className="grid grid-cols-2 gap-2">
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
                  disabled={updatingStatus}
                  className="flex-1 py-2.5 px-4 bg-[#1a1a1a] hover:bg-[#222] border border-[#ff3c00]/30 hover:border-[#ff3c00]/60 text-[#ff6644] font-semibold rounded-lg text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {updatingStatus && sendingBack ? <span className="flex items-center justify-center gap-2"><Spinner />Sending...</span> : 'Send Back'}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={updatingStatus}
                  className="btn-green flex-1 py-2.5 px-4 text-white font-semibold rounded-lg text-base disabled:cursor-not-allowed cursor-pointer"
                >
                  {updatingStatus && !sendingBack ? <span className="flex items-center justify-center gap-2"><Spinner />Approving...</span> : 'Approve'}
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

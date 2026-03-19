'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Send, Lock, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Task, User, Comment, TaskStatus, Episode } from '@/lib/types'
import { StatusBadge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { ApprovalModal } from './ApprovalModal'
import { cn, formatDate, isOverdue, STATUS_LABELS } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { sendNotification } from '@/lib/notifications'

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
  ready: 'in_progress',
  in_progress: 'in_review',
  revision: 'in_review',
}

export function TaskModal({ task, currentUser, onClose, onUpdate, episode }: Props) {
  const supabase = createClient()
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [approvalAction, setApprovalAction] = useState<'approve' | 'revision'>('approve')
  const commentEndRef = useRef<HTMLDivElement>(null)

  const isAssignee = task.assignee_id === currentUser.id
  const isReviewer = task.requires_approval
    ? (currentUser.id === task.approver_id || currentUser.role === 'admin')
    : false
  const overdue = isOverdue(task.due_date, task.status, task.requires_approval, task.review_started_at)
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS]

  useEffect(() => { fetchComments() }, [task.id])
  useEffect(() => { commentEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [comments])

  async function fetchComments() {
    const { data } = await supabase
      .from('comments')
      .select('*, author:users(*)')
      .eq('task_id', task.id)
      .order('created_at', { ascending: true })
    if (data) setComments(data as unknown as Comment[])
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim()) return
    setSubmitting(true)
    await supabase.from('comments').insert({
      task_id: task.id,
      author_id: currentUser.id,
      body: newComment.trim(),
    })
    setNewComment('')
    setSubmitting(false)
    fetchComments()
  }

  async function updateStatus(newStatus: TaskStatus) {
    // If task doesn't need approval, submitting goes straight to approved
    const resolvedStatus: TaskStatus =
      newStatus === 'in_review' && !task.requires_approval ? 'approved' : newStatus

    if (resolvedStatus === 'in_review' && task.requires_approval) {
      // Notify the specific approver only
      if (task.approver_id && task.approver_id !== currentUser.id) {
        await sendNotification(supabase, {
          userId: task.approver_id,
          type: 'task_submitted_review',
          title: 'Task submitted for review',
          body: `${currentUser.name} submitted "${task.label}" for review`,
          taskId: task.id,
          episodeId: task.episode_id,
        })
      }
      fetch('/api/slack/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'review_submitted',
          episodeId: task.episode_id,
          taskLabel: task.label,
          assigneeName: currentUser.name,
        }),
      }).catch(() => {})
    }

    setUpdatingStatus(true)
    const updatePayload: Record<string, unknown> = { status: resolvedStatus }
    if (resolvedStatus === 'in_review') updatePayload.review_started_at = new Date().toISOString()
    const { data } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', task.id)
      .select('*, assignee:users(*)')
      .single()

    if (data) {
      onUpdate(data as unknown as Task)
      await checkAndUnlockDependencies(task.episode_id)
    }
    setUpdatingStatus(false)
  }

  async function checkAndUnlockDependencies(episodeId: string) {
    const { data: allTasks } = await supabase.from('tasks').select('*').eq('episode_id', episodeId)
    if (!allTasks) return
    const approvedIds = new Set(allTasks.filter(t => t.status === 'approved').map(t => t.id))
    for (const t of allTasks) {
      if (t.status === 'locked' && t.dep_task_ids.length > 0) {
        const allDepsApproved = t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
        if (allDepsApproved) {
          // Set dynamic due date (+Xhr after dep completion) when unlocking
          const updateData: Record<string, unknown> = { status: 'ready' }
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
              title: 'New task ready',
              body: `"${t.label}" is now ready for ${episode ? `${episode.guest_name} / ${episode.client_label}` : ''}`,
              taskId: t.id,
              episodeId,
            })
          }
        }
      }
    }
  }

  const nextStatus = NEXT_STATUS[task.status]
  const canAction = isAssignee && nextStatus !== undefined
  const canReview = isReviewer && task.status === 'in_review'

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div
          className="bg-[#141414] border border-[#2e2e2e] w-full sm:max-w-2xl sm:rounded-xl rounded-t-xl max-h-[90vh] flex flex-col shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-[#2e2e2e]">
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
                    <Avatar name={task.assignee.name} color={task.assignee.avatar_color} size="sm" />
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
              <div className="bg-[#ff3c00]/10 border border-[#ff3c00]/20 rounded-lg p-3">
                <p className="text-base text-[#ff9980]">{task.note}</p>
              </div>
            )}

            {task.status === 'locked' && (
              <div className="flex items-center gap-2 text-base text-[#666] bg-[#1e1e1e] rounded-lg p-3">
                <Lock className="w-4 h-4" />
                <span>Waiting for dependencies to be approved</span>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-[#888] uppercase tracking-wider mb-3">
                Comments ({comments.length})
              </h3>
              <div className="space-y-3">
                {comments.map(comment => (
                  <div key={comment.id} className="flex gap-3">
                    {comment.author && (
                      <Avatar name={comment.author.name} color={comment.author.avatar_color} size="sm" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-white">{comment.author?.name}</span>
                        <span className="text-xs text-[#666]">{formatDate(comment.created_at)}</span>
                      </div>
                      <p className="text-base text-[#ccc] mt-0.5">{comment.body}</p>
                    </div>
                  </div>
                ))}
                <div ref={commentEndRef} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[#2e2e2e] p-4 space-y-3">
            <form onSubmit={submitComment} className="flex gap-2">
              <Avatar name={currentUser.name} color={currentUser.avatar_color} size="sm" />
              <input
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 px-3 py-1.5 bg-[#1e1e1e] border border-[#2e2e2e] rounded-lg text-base text-white placeholder-[#555] focus:outline-none focus:ring-2 focus:ring-[#ff3c00]"
              />
              <button
                type="submit"
                disabled={submitting || !newComment.trim()}
                className="p-2 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

            {canAction && (
              <button
                onClick={() => updateStatus(nextStatus!)}
                disabled={updatingStatus}
                className="w-full py-2.5 px-4 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white font-semibold rounded-lg text-base transition-colors"
              >
                {updatingStatus ? 'Updating...' : (
                  task.status === 'in_progress'
                    ? (task.requires_approval ? 'Submit for Review' : 'Mark Complete')
                  : task.status === 'ready' ? 'Start Task'
                  : task.status === 'revision' ? 'Resubmit for Review'
                  : `Mark as ${STATUS_LABELS[nextStatus!]}`
                )}
              </button>
            )}

            {canReview && (
              <div className="flex gap-2">
                <button
                  onClick={() => { setApprovalAction('revision'); setShowApprovalModal(true) }}
                  className="flex-1 py-2.5 px-4 bg-[#1e1e1e] hover:bg-[#333] border border-[#ff3c00]/40 text-[#ff3c00] font-semibold rounded-lg text-base transition-colors"
                >
                  Send Back
                </button>
                <button
                  onClick={() => { setApprovalAction('approve'); setShowApprovalModal(true) }}
                  className="flex-1 py-2.5 px-4 bg-[#ff3c00] hover:bg-[#e63600] text-white font-semibold rounded-lg text-base transition-colors"
                >
                  Approve
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showApprovalModal && (
        <ApprovalModal
          task={task}
          action={approvalAction}
          currentUser={currentUser}
          onClose={() => setShowApprovalModal(false)}
          onConfirm={(updatedTask) => {
            setShowApprovalModal(false)
            onUpdate(updatedTask)
            onClose()
          }}
        />
      )}
    </>
  )
}

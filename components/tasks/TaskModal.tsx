'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Send, Lock, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Task, User, Comment, TaskStatus } from '@/lib/types'
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
}

const NEXT_STATUS: Partial<Record<TaskStatus, TaskStatus>> = {
  ready: 'in_progress',
  in_progress: 'in_review',
  revision: 'in_review',
}

export function TaskModal({ task, currentUser, onClose, onUpdate }: Props) {
  const supabase = createClient()
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [approvalAction, setApprovalAction] = useState<'approve' | 'revision'>('approve')
  const commentEndRef = useRef<HTMLDivElement>(null)

  const isAssignee = task.assignee_id === currentUser.id
  const isReviewer = currentUser.role === 'admin' || currentUser.name === 'Ali'
  const overdue = isOverdue(task.due_date, task.status)
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS]

  useEffect(() => {
    fetchComments()
  }, [task.id])

  useEffect(() => {
    commentEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments])

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
    if (newStatus === 'in_review') {
      // Notify Ali (and Francis) about review submission
      const { data: reviewers } = await supabase
        .from('users')
        .select('*')
        .in('name', ['Ali', 'Francis'])

      for (const reviewer of reviewers || []) {
        if (reviewer.id !== currentUser.id) {
          await sendNotification(supabase, {
            userId: reviewer.id,
            type: 'task_submitted_review',
            title: 'Task submitted for review',
            body: `${currentUser.name} submitted "${task.label}" for review`,
            taskId: task.id,
            episodeId: task.episode_id,
            slackWebhookUrl: reviewer.slack_webhook_url,
          })
        }
      }
    }

    setUpdatingStatus(true)
    const { data } = await supabase
      .from('tasks')
      .update({ status: newStatus })
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
    const { data: allTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('episode_id', episodeId)

    if (!allTasks) return

    const approvedIds = new Set(
      allTasks.filter(t => t.status === 'approved').map(t => t.id)
    )

    for (const t of allTasks) {
      if (t.status === 'locked' && t.dep_task_ids.length > 0) {
        const allDepsApproved = t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
        if (allDepsApproved) {
          await supabase
            .from('tasks')
            .update({ status: 'ready' })
            .eq('id', t.id)

          // Notify assignee
          const { data: assignee } = await supabase
            .from('users')
            .select('*')
            .eq('id', t.assignee_id)
            .single()

          if (assignee) {
            const { data: episode } = await supabase
              .from('episodes')
              .select('*')
              .eq('id', episodeId)
              .single()

            await sendNotification(supabase, {
              userId: assignee.id,
              type: 'task_unlocked',
              title: 'New task ready',
              body: `"${t.label}" is now ready for ${episode ? `${episode.guest_name} / ${episode.client_label}` : ''}`,
              taskId: t.id,
              episodeId: episodeId,
              slackWebhookUrl: assignee.slack_webhook_url,
            })
          }
        }
      }
    }
  }

  function handleApprovalOpen(action: 'approve' | 'revision') {
    setApprovalAction(action)
    setShowApprovalModal(true)
  }

  const nextStatus = NEXT_STATUS[task.status]
  const canAction = isAssignee && nextStatus !== undefined
  const canReview = isReviewer && task.status === 'in_review'

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div
          className="bg-white dark:bg-gray-900 w-full sm:max-w-2xl sm:rounded-xl rounded-t-xl max-h-[90vh] flex flex-col shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-800">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: trackColor }}
                />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{task.track}</span>
                <StatusBadge status={task.status} />
                {overdue && (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <AlertCircle className="w-3 h-3" />
                    Overdue
                  </span>
                )}
              </div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white leading-snug">{task.label}</h2>
            </div>
            <button onClick={onClose} className="ml-4 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Meta */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Assignee</p>
                {task.assignee && (
                  <div className="flex items-center gap-2">
                    <Avatar name={task.assignee.name} color={task.assignee.avatar_color} size="sm" />
                    <span className="text-gray-900 dark:text-white font-medium">{task.assignee.name}</span>
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Due Date</p>
                <p className={cn('font-medium', overdue ? 'text-red-500' : 'text-gray-900 dark:text-white')}>
                  {formatDate(task.due_date)}
                </p>
              </div>
            </div>

            {/* Note */}
            {task.note && (
              <div className="bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-300">{task.note}</p>
              </div>
            )}

            {/* Locked state */}
            {task.status === 'locked' && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <Lock className="w-4 h-4" />
                <span>Waiting for dependencies to be approved</span>
              </div>
            )}

            {/* Comments */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
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
                        <span className="text-xs font-semibold text-gray-900 dark:text-white">
                          {comment.author?.name}
                        </span>
                        <span className="text-xs text-gray-400">{formatDate(comment.created_at)}</span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{comment.body}</p>
                    </div>
                  </div>
                ))}
                <div ref={commentEndRef} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 dark:border-gray-800 p-4 space-y-3">
            {/* Comment input */}
            <form onSubmit={submitComment} className="flex gap-2">
              <Avatar name={currentUser.name} color={currentUser.avatar_color} size="sm" />
              <input
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={submitting || !newComment.trim()}
                className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

            {/* Action Buttons */}
            {canAction && (
              <button
                onClick={() => updateStatus(nextStatus!)}
                disabled={updatingStatus}
                className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
              >
                {updatingStatus ? 'Updating...' : (
                  task.status === 'in_progress' ? 'Submit for Review' :
                  task.status === 'ready' ? 'Start Task' :
                  task.status === 'revision' ? 'Resubmit for Review' :
                  `Mark as ${STATUS_LABELS[nextStatus!]}`
                )}
              </button>
            )}

            {canReview && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleApprovalOpen('revision')}
                  className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg text-sm transition-colors"
                >
                  Send Back
                </button>
                <button
                  onClick={() => handleApprovalOpen('approve')}
                  className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg text-sm transition-colors"
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

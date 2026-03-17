'use client'

import { useState, useEffect } from 'react'
import { X, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Task, User } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { sendNotification } from '@/lib/notifications'
import { format } from 'date-fns'

interface Props {
  task: Task
  action: 'approve' | 'revision'
  currentUser: User
  onClose: () => void
  onConfirm: (updatedTask: Task) => void
}

interface NextTask {
  id: string
  label: string
  assignee: User
  dueDate: string
}

export function ApprovalModal({ task, action, currentUser, onClose, onConfirm }: Props) {
  const supabase = createClient()
  const [nextTasks, setNextTasks] = useState<NextTask[]>([])
  const [dueDates, setDueDates] = useState<Record<string, string>>({})
  const [revisedTaskDueDate, setRevisedTaskDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  // The task being sent back (the current task's assignee does the revision)
  // For approve: find tasks whose deps include this task ID
  // For revision: find the task (this task itself goes back to editor)

  useEffect(() => {
    loadNextTasks()
  }, [task.id])

  async function loadNextTasks() {
    setLoading(true)

    if (action === 'approve') {
      // Find all tasks in this episode that have this task in their deps and are currently locked
      const { data: allTasks } = await supabase
        .from('tasks')
        .select('*, assignee:users(*)')
        .eq('episode_id', task.episode_id)
        .eq('status', 'locked')

      if (!allTasks) { setLoading(false); return }

      // Get currently approved tasks (excluding current one, pretend it's approved)
      const { data: episodeTasks } = await supabase
        .from('tasks')
        .select('id, status')
        .eq('episode_id', task.episode_id)

      const approvedIds = new Set([
        ...(episodeTasks || []).filter(t => t.status === 'approved').map(t => t.id),
        task.id, // pretend current task is approved
      ])

      const unlocking = allTasks.filter(t =>
        t.dep_task_ids.includes(task.id) &&
        t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
      )

      setNextTasks(unlocking.map(t => ({
        id: t.id,
        label: t.label,
        assignee: t.assignee,
        dueDate: t.due_date || '',
      })))

      const initialDates: Record<string, string> = {}
      unlocking.forEach(t => {
        initialDates[t.id] = t.due_date ? format(new Date(t.due_date), 'yyyy-MM-dd') : ''
      })
      setDueDates(initialDates)
    } else {
      // Revision: show the current task going back to the editor
      const { data: assignee } = await supabase
        .from('users')
        .select('*')
        .eq('id', task.assignee_id)
        .single()

      if (assignee) {
        setNextTasks([{
          id: task.id,
          label: task.label,
          assignee: assignee,
          dueDate: '',
        }])
      }
      setRevisedTaskDueDate('')
    }

    setLoading(false)
  }

  async function handleConfirm() {
    setSubmitting(true)

    if (action === 'approve') {
      // Update current task to approved
      const { data: updatedTask } = await supabase
        .from('tasks')
        .update({ status: 'approved' })
        .eq('id', task.id)
        .select('*, assignee:users(*)')
        .single()

      // Update next tasks: set to ready + update due dates
      for (const nextTask of nextTasks) {
        const dueDate = dueDates[nextTask.id] || null
        await supabase
          .from('tasks')
          .update({ status: 'ready', due_date: dueDate })
          .eq('id', nextTask.id)

        // Notify assignee
        const { data: episode } = await supabase
          .from('episodes')
          .select('*')
          .eq('id', task.episode_id)
          .single()

        await sendNotification(supabase, {
          userId: nextTask.assignee.id,
          type: 'task_unlocked',
          title: 'New task ready',
          body: `"${nextTask.label}" is now ready${episode ? ` for ${episode.guest_name} / ${episode.client_label}` : ''}`,
          taskId: nextTask.id,
          episodeId: task.episode_id,
          slackWebhookUrl: nextTask.assignee.slack_webhook_url,
        })
      }

      // Also check and unlock any other dependent tasks
      await checkAndUnlockAll(task.episode_id, task.id)

      // Notify original assignee that their task was approved
      if (task.assignee_id !== currentUser.id) {
        const { data: assignee } = await supabase
          .from('users')
          .select('*')
          .eq('id', task.assignee_id)
          .single()

        if (assignee) {
          await sendNotification(supabase, {
            userId: assignee.id,
            type: 'task_approved',
            title: 'Task approved',
            body: `"${task.label}" was approved by ${currentUser.name}`,
            taskId: task.id,
            episodeId: task.episode_id,
            slackWebhookUrl: assignee.slack_webhook_url,
          })
        }
      }

      if (updatedTask) onConfirm(updatedTask as unknown as Task)

    } else {
      // Revision
      const { data: updatedTask } = await supabase
        .from('tasks')
        .update({
          status: 'revision',
          due_date: revisedTaskDueDate || null,
        })
        .eq('id', task.id)
        .select('*, assignee:users(*)')
        .single()

      // Notify the editor
      const { data: assignee } = await supabase
        .from('users')
        .select('*')
        .eq('id', task.assignee_id)
        .single()

      if (assignee) {
        await sendNotification(supabase, {
          userId: assignee.id,
          type: 'task_revision',
          title: 'Task sent back for revision',
          body: `"${task.label}" was sent back for revision${revisedTaskDueDate ? `. Due: ${format(new Date(revisedTaskDueDate), 'MMM d, yyyy')}` : ''}`,
          taskId: task.id,
          episodeId: task.episode_id,
          slackWebhookUrl: assignee.slack_webhook_url,
        })
      }

      if (updatedTask) onConfirm(updatedTask as unknown as Task)
    }

    setSubmitting(false)
  }

  async function checkAndUnlockAll(episodeId: string, justApprovedId: string) {
    const { data: allTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('episode_id', episodeId)

    if (!allTasks) return

    const approvedIds = new Set(
      allTasks.filter(t => t.status === 'approved' || t.id === justApprovedId).map(t => t.id)
    )

    for (const t of allTasks) {
      if (t.status === 'locked' && t.dep_task_ids.length > 0) {
        const allDepsApproved = t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
        if (allDepsApproved) {
          await supabase.from('tasks').update({ status: 'ready' }).eq('id', t.id)
        }
      }
    }
  }

  const today = format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="fixed inset-0 bg-black/80 z-60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {action === 'approve' ? 'Approve Task' : 'Send Back for Revision'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="text-center py-4 text-gray-500 text-sm">Loading...</div>
          ) : action === 'approve' ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Approving <strong className="text-gray-900 dark:text-white">&ldquo;{task.label}&rdquo;</strong>.
                {nextTasks.length > 0
                  ? ` This will unlock ${nextTasks.length} task${nextTasks.length !== 1 ? 's' : ''}. Set their due dates:`
                  : ' No tasks will be unlocked immediately.'}
              </p>

              {nextTasks.map(nextTask => (
                <div key={nextTask.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-green-500 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{nextTask.label}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Avatar name={nextTask.assignee.name} color={nextTask.assignee.avatar_color} size="sm" />
                        <span className="text-xs text-gray-500 dark:text-gray-400">{nextTask.assignee.name}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Due date</label>
                    <input
                      type="date"
                      value={dueDates[nextTask.id] || ''}
                      min={today}
                      onChange={e => setDueDates(prev => ({ ...prev, [nextTask.id]: e.target.value }))}
                      className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Sending <strong className="text-gray-900 dark:text-white">&ldquo;{task.label}&rdquo;</strong> back to{' '}
                <strong className="text-gray-900 dark:text-white">{nextTasks[0]?.assignee.name}</strong> for revision.
              </p>

              {nextTasks[0] && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={nextTasks[0].assignee.name} color={nextTasks[0].assignee.avatar_color} size="sm" />
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{nextTasks[0].label}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Revised edit due date</label>
                    <input
                      type="date"
                      value={revisedTaskDueDate}
                      min={today}
                      onChange={e => setRevisedTaskDueDate(e.target.value)}
                      className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 p-5 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className={`flex-1 py-2 px-4 font-medium rounded-lg text-sm text-white transition-colors disabled:opacity-50 ${
              action === 'approve'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {submitting ? 'Saving...' : action === 'approve' ? 'Confirm Approval' : 'Send Back'}
          </button>
        </div>
      </div>
    </div>
  )
}

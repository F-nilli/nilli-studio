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

  useEffect(() => { loadNextTasks() }, [task.id])

  async function loadNextTasks() {
    setLoading(true)
    if (action === 'approve') {
      const { data: allTasks } = await supabase
        .from('tasks').select('*, assignee:users(*)')
        .eq('episode_id', task.episode_id).eq('status', 'locked')

      const { data: episodeTasks } = await supabase
        .from('tasks').select('id, status').eq('episode_id', task.episode_id)

      const approvedIds = new Set([
        ...(episodeTasks || []).filter(t => t.status === 'approved').map(t => t.id),
        task.id,
      ])

      const unlocking = (allTasks || []).filter(t =>
        t.dep_task_ids.includes(task.id) &&
        t.dep_task_ids.every((depId: string) => approvedIds.has(depId))
      )

      setNextTasks(unlocking.map(t => ({ id: t.id, label: t.label, assignee: t.assignee, dueDate: t.due_date || '' })))
      const initialDates: Record<string, string> = {}
      unlocking.forEach(t => { initialDates[t.id] = t.due_date ? format(new Date(t.due_date), 'yyyy-MM-dd') : '' })
      setDueDates(initialDates)
    } else {
      const { data: assignee } = await supabase.from('users').select('*').eq('id', task.assignee_id).single()
      if (assignee) setNextTasks([{ id: task.id, label: task.label, assignee, dueDate: '' }])
    }
    setLoading(false)
  }

  async function handleConfirm() {
    setSubmitting(true)
    if (action === 'approve') {
      const { data: updatedTask } = await supabase
        .from('tasks').update({ status: 'approved' }).eq('id', task.id)
        .select('*, assignee:users(*)').single()

      for (const nextTask of nextTasks) {
        await supabase.from('tasks')
          .update({ status: 'ready', due_date: dueDates[nextTask.id] || null })
          .eq('id', nextTask.id)

        const { data: episode } = await supabase.from('episodes').select('*').eq('id', task.episode_id).single()
        await sendNotification(supabase, {
          userId: nextTask.assignee.id,
          type: 'task_unlocked',
          title: 'New task ready',
          body: `"${nextTask.label}" is now ready${episode ? ` for ${episode.guest_name} / ${episode.client_label}` : ''}`,
          taskId: nextTask.id,
          episodeId: task.episode_id,
        })
      }

      // Check for any other newly unlockable tasks
      const { data: allTasks } = await supabase.from('tasks').select('*').eq('episode_id', task.episode_id)
      if (allTasks) {
        const approvedIds = new Set([...allTasks.filter(t => t.status === 'approved' || t.id === task.id).map(t => t.id)])
        for (const t of allTasks) {
          if (t.status === 'locked' && t.dep_task_ids.length > 0) {
            if (t.dep_task_ids.every((depId: string) => approvedIds.has(depId))) {
              await supabase.from('tasks').update({ status: 'ready' }).eq('id', t.id)
            }
          }
        }
      }

      if (task.assignee_id !== currentUser.id) {
        const { data: assignee } = await supabase.from('users').select('*').eq('id', task.assignee_id).single()
        if (assignee) {
          await sendNotification(supabase, {
            userId: assignee.id, type: 'task_approved',
            title: 'Task approved',
            body: `"${task.label}" was approved by ${currentUser.name}`,
            taskId: task.id, episodeId: task.episode_id,
          })
        }
      }

      // Slack: approval block
      fetch('/api/slack/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approval',
          episodeId: task.episode_id,
          completedTaskLabel: task.label,
          nextTasks: nextTasks.map(t => ({ label: t.label, assigneeName: t.assignee.name })),
        }),
      }).catch(() => {})

      if (updatedTask) onConfirm(updatedTask as unknown as Task)
    } else {
      const { data: updatedTask } = await supabase
        .from('tasks').update({ status: 'revision', due_date: revisedTaskDueDate || null })
        .eq('id', task.id).select('*, assignee:users(*)').single()

      const { data: assignee } = await supabase.from('users').select('*').eq('id', task.assignee_id).single()
      if (assignee) {
        await sendNotification(supabase, {
          userId: assignee.id, type: 'task_revision',
          title: 'Task sent back for revision',
          body: `"${task.label}" was sent back for revision${revisedTaskDueDate ? `. Due: ${format(new Date(revisedTaskDueDate), 'MMM d, yyyy')}` : ''}`,
          taskId: task.id, episodeId: task.episode_id,
        })

        // Slack: revision block
        fetch('/api/slack/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'revision',
            episodeId: task.episode_id,
            taskLabel: task.label,
            assigneeName: assignee.name,
            dueDate: revisedTaskDueDate ? format(new Date(revisedTaskDueDate), 'MMM d') : undefined,
          }),
        }).catch(() => {})
      }

      if (updatedTask) onConfirm(updatedTask as unknown as Task)
    }
    setSubmitting(false)
  }

  const today = format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="fixed inset-0 bg-black/80 z-60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141414] border border-[#2e2e2e] rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-[#2e2e2e]">
          <h2 className="text-lg font-bold text-white">
            {action === 'approve' ? 'Approve Task' : 'Send Back for Revision'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[#1e1e1e] text-[#888]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="text-center py-4 text-[#888] text-base">Loading...</div>
          ) : action === 'approve' ? (
            <>
              <p className="text-base text-[#ccc]">
                Approving <strong className="text-white">&ldquo;{task.label}&rdquo;</strong>.
                {nextTasks.length > 0
                  ? ` This will unlock ${nextTasks.length} task${nextTasks.length !== 1 ? 's' : ''}. Set their due dates:`
                  : ' No tasks will be unlocked immediately.'}
              </p>
              {nextTasks.map(nextTask => (
                <div key={nextTask.id} className="border border-[#2e2e2e] rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[#ff3c00] shrink-0" />
                    <div>
                      <p className="text-base font-medium text-white">{nextTask.label}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Avatar name={nextTask.assignee.name} color={nextTask.assignee.avatar_color} size="sm" />
                        <span className="text-sm text-[#888]">{nextTask.assignee.name}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-[#888] mb-1">Due date</label>
                    <input
                      type="date" value={dueDates[nextTask.id] || ''} min={today}
                      onChange={e => setDueDates(prev => ({ ...prev, [nextTask.id]: e.target.value }))}
                      className="w-full px-3 py-1.5 bg-[#1e1e1e] border border-[#2e2e2e] rounded-lg text-base text-white focus:outline-none focus:ring-2 focus:ring-[#ff3c00]"
                    />
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="text-base text-[#ccc]">
                Sending <strong className="text-white">&ldquo;{task.label}&rdquo;</strong> back to{' '}
                <strong className="text-white">{nextTasks[0]?.assignee.name}</strong> for revision.
              </p>
              {nextTasks[0] && (
                <div className="border border-[#2e2e2e] rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={nextTasks[0].assignee.name} color={nextTasks[0].assignee.avatar_color} size="sm" />
                    <p className="text-base font-medium text-white">{nextTasks[0].label}</p>
                  </div>
                  <div>
                    <label className="block text-sm text-[#888] mb-1">Revised edit due date</label>
                    <input
                      type="date" value={revisedTaskDueDate} min={today}
                      onChange={e => setRevisedTaskDueDate(e.target.value)}
                      className="w-full px-3 py-1.5 bg-[#1e1e1e] border border-[#2e2e2e] rounded-lg text-base text-white focus:outline-none focus:ring-2 focus:ring-[#ff3c00]"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 p-5 border-t border-[#2e2e2e]">
          <button onClick={onClose} className="flex-1 py-2.5 px-4 border border-[#2e2e2e] text-[#ccc] font-medium rounded-lg text-base hover:bg-[#1e1e1e] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm} disabled={submitting}
            className="flex-1 py-2.5 px-4 bg-[#ff3c00] hover:bg-[#e63600] font-semibold rounded-lg text-base text-white transition-colors disabled:opacity-50"
          >
            {submitting ? 'Saving...' : action === 'approve' ? 'Confirm Approval' : 'Send Back'}
          </button>
        </div>
      </div>
    </div>
  )
}

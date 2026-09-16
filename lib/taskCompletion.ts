import type { Task, TaskStatus } from './types'

/** Client correction rounds finish without another approval cycle. */
export function completionStatus(task: Pick<Task, 'status' | 'approver_id' | 'client_revision_parent_id'>): TaskStatus | null {
  if (task.status !== 'in_progress' && task.status !== 'revision') return null
  if (task.status === 'revision' && task.client_revision_parent_id) return 'done'
  return task.approver_id ? 'in_review' : 'done'
}

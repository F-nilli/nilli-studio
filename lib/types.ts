export type UserRole = 'admin' | 'member'

export type TaskStatus =
  | 'locked'
  | 'ready'
  | 'in_progress'
  | 'in_review'
  | 'approved'
  | 'revision'
  | 'done'

export type Track =
  | 'Long-form'
  | 'Trailer'
  | 'Thumbnails'
  | 'Clips & Shorts'
  | 'Review'
  | 'Publishing'

export type ClientKey =
  | 'brandon_gentile'
  | 'bitcoin_edge'
  | 'peruvian_bull'
  | 'walker_america'
  | 'youre_the_voice'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  avatar_color: string
  slack_webhook_url: string | null
  created_at: string
}

export interface Episode {
  id: string
  client_key: ClientKey
  client_label: string
  guest_name: string
  release_date: string
  footage_url: string | null
  created_by: string
  created_at: string
}

export interface Task {
  id: string
  episode_id: string
  template_task_id: number
  label: string
  assignee_id: string
  track: Track
  status: TaskStatus
  due_date: string | null
  note: string | null
  dep_task_ids: string[]
  created_at: string
  updated_at: string
  // Joined
  assignee?: User
  episode?: Episode
}

export interface Comment {
  id: string
  task_id: string
  author_id: string
  body: string
  created_at: string
  // Joined
  author?: User
}

export type NotificationType =
  | 'task_unlocked'
  | 'task_submitted_review'
  | 'task_approved'
  | 'task_revision'
  | 'task_overdue'

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  task_id: string | null
  episode_id: string | null
  read: boolean
  created_at: string
}

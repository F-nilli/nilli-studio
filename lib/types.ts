export type UserRole = 'admin' | 'ops_manager' | 'member'

// Permission helpers
export function canManageTeam(user: { role: UserRole }) { return user.role === 'admin' }
export function canManageClients(user: { role: UserRole }) { return user.role === 'admin' || user.role === 'ops_manager' }
export function canEditDates(user: { role: UserRole }) { return user.role === 'admin' || user.role === 'ops_manager' }
export function canApprove(user: { role: UserRole }) { return user.role === 'admin' || user.role === 'ops_manager' }
export function canSeeAllEpisodes(user: { role: UserRole }) { return user.role === 'admin' || user.role === 'ops_manager' }
export function canAccessSettings(user: { role: UserRole }) { return user.role === 'admin' || user.role === 'ops_manager' }
export function canCreateProject(user: { role: UserRole }) { return user.role === 'admin' || user.role === 'ops_manager' }

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

export type ClientKey = string

export interface User {
  id: string
  email: string
  name: string
  username?: string
  role: UserRole
  avatar_color: string
  avatar_url: string | null
  created_at: string
  active?: boolean
  last_seen_at?: string | null
  password_changed?: boolean
}

export interface Episode {
  id: string
  client_key: ClientKey
  client_label: string
  guest_name: string
  release_date: string
  footage_url: string | null
  notes: string | null
  template_name: string | null
  source_episode_id: string | null
  created_by: string
  created_at: string
  published: boolean
  published_at: string | null
  archived: boolean
  completed_at: string | null
  restored_at: string | null
  restore_count: number
  // Joined
  source?: { id: string; guest_name: string; template_name: string | null }
}

export interface PipelineTrigger {
  id: string
  client_id: string
  template_name: string
  trigger_type: 'on_task' | 'on_project'
  trigger_seq_id: number | null
  offset_days: number
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
  requires_approval: boolean
  approver_id: string | null
  review_started_at: string | null
  created_at: string
  updated_at: string
  // Joined
  assignee?: User
  approver?: User
  episode?: Episode
}

export interface Comment {
  id: string
  task_id: string | null
  episode_id: string | null
  author_id: string
  body: string
  internal: boolean
  created_at: string
  parent_comment_id?: string | null
  depth?: number
  // Joined
  author?: User
}

export type NotificationType =
  | 'task_unlocked'
  | 'task_submitted_review'
  | 'task_approved'
  | 'task_revision'
  | 'task_overdue'
  | 'task_comment_mention'

export interface Client {
  id: string
  key: string
  label: string
  active: boolean
  created_at: string
  last_saved_at: string | null
  last_saved_by_name: string | null
  slack_channel_id: string | null
}

export interface DbTaskTemplate {
  id: string
  client_id: string
  template_name: string
  seq_id: number
  label: string
  assignee_id: string | null
  track: Track
  due_days: number | null
  note: string | null
  dep_seq_ids: number[]
  requires_approval: boolean
  approver_id: string | null
  created_at: string
  assignee?: User
  approver?: User
}

export interface ActivityEntry {
  id: string
  episode_id: string | null
  task_id: string | null
  from_status: string | null
  to_status: string | null
  changed_at: string
  changed_by: string | null
  note: string | null
  task?: { label: string } | null
  episode?: { guest_name: string; client_label: string } | null
  actor?: { name: string; avatar_color: string; avatar_url: string | null } | null
}

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

export type MessageNotificationType = 'mention' | 'task_comment'

export interface MessageNotification {
  id: string
  user_id: string
  author_id: string
  comment_id: string
  task_id: string | null
  episode_id: string
  type: MessageNotificationType
  read: boolean
  created_at: string
  // joined
  author?: User
  comment?: { body: string }
  task?: { label: string }
  episode?: { guest_name: string; client_label: string }
}

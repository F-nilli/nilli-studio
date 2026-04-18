import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { subDays, parseISO, format, isAfter, startOfDay } from 'date-fns'
import { TaskStatus } from './types'
import { TaskTemplate } from './templates'

export function formatRelativeTime(dateStr: string): string {
  const date = parseDate(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return `Yesterday at ${format(date, 'h:mm a')}`
  if (diffDays < 7) return `${format(date, 'EEE')} at ${format(date, 'h:mm a')}`
  return format(date, 'MMM d')
}

export const STATUS_LABELS: Record<string, string> = {
  locked: 'Locked',
  ready: 'Ready',
  in_progress: 'In Progress',
  in_review: 'In Review',
  approved: 'Approved',
  revision: 'Revision',
  done: 'Done',
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Normalize a DB timestamp string to always have a timezone indicator.
// Supabase plain `timestamp` columns return without 'Z'; treat those as UTC.
// Date-only strings (no 'T') are left alone — they use local-date semantics.
function normalizeDateStr(s: string): string {
  return s.includes('T') && !s.includes('+') && !s.endsWith('Z') ? s + 'Z' : s
}

// Parse a DB date/timestamp string into a Date, correctly treating UTC timestamps.
export function parseDate(s: string): Date {
  return parseISO(normalizeDateStr(s))
}

export function formatDate(date: string | Date | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseDate(date) : date
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
  return hasTime ? format(d, 'MMM d, yyyy · h:mm a') : format(d, 'MMM d, yyyy')
}

// Convert DB timestamp string to datetime-local input value in the user's LOCAL timezone
export function toDatetimeLocal(isoString: string | null): string {
  if (!isoString) return ''
  return format(parseDate(isoString), "yyyy-MM-dd'T'HH:mm")
}

// Convert datetime-local input value (local time) to UTC ISO string for DB storage
export function fromDatetimeLocal(value: string): string {
  return new Date(value).toISOString()
}

// Strip minutes/seconds from a datetime-local string → force to :00
export function roundToHour(value: string): string {
  if (!value) return value
  const d = new Date(value)
  d.setMinutes(0, 0, 0)
  return format(d, "yyyy-MM-dd'T'HH:mm")
}

export function isOverdue(
  dueDate: string | null,
  status: TaskStatus,
  requiresApproval?: boolean,
  reviewStartedAt?: string | null,
): boolean {
  if (status === 'approved' || status === 'done') return false
  // Flag approval tasks that have been waiting in review for 12+ hours
  if (status === 'in_review' && requiresApproval && reviewStartedAt) {
    const hoursInReview = (Date.now() - new Date(reviewStartedAt).getTime()) / (1000 * 60 * 60)
    if (hoursInReview >= 12) return true
  }
  if (!dueDate) return false
  return isAfter(startOfDay(new Date()), startOfDay(parseDate(dueDate)))
}

export function calculateDueDates(
  releaseDate: string,
  templates: TaskTemplate[]
): Record<number, Date | null> {
  const release = parseISO(releaseDate)

  const result: Record<number, Date | null> = {}
  for (const t of templates) {
    if (t.dueDays === null) {
      result[t.id] = null
    } else {
      // due_date = release_date - task.dueDays days
      const d = subDays(release, t.dueDays)
      d.setHours(9, 0, 0, 0)
      result[t.id] = d
    }
  }
  return result
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function getStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'locked': return 'text-gray-400 dark:text-gray-600'
    case 'ready': return 'text-blue-500'
    case 'in_progress': return 'text-yellow-500'
    case 'in_review': return 'text-purple-500'
    case 'approved': return 'text-green-500'
    case 'revision': return 'text-red-500'
    case 'done': return 'text-green-600'
    default: return 'text-gray-400'
  }
}

export function getStatusBg(status: TaskStatus): string {
  switch (status) {
    case 'locked': return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
    case 'ready': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    case 'in_progress': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    case 'in_review': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
    case 'approved': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    case 'revision': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    case 'done': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    default: return 'bg-gray-100 text-gray-500'
  }
}

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { subDays, parseISO, format, isAfter, startOfDay } from 'date-fns'
import { TaskStatus } from './types'
import { TaskTemplate } from './templates'

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

export function formatDate(date: string | Date | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
  return hasTime ? format(d, 'MMM d, yyyy · h:mm a') : format(d, 'MMM d, yyyy')
}

// Convert DB timestamp string to datetime-local input value (YYYY-MM-DDTHH:mm)
export function toDatetimeLocal(isoString: string | null): string {
  if (!isoString) return ''
  return isoString.slice(0, 16)
}

// Convert datetime-local input value to DB timestamp string
export function fromDatetimeLocal(value: string): string {
  return value + ':00'
}

export function isOverdue(dueDate: string | null, status: TaskStatus): boolean {
  if (!dueDate) return false
  if (status === 'approved' || status === 'done') return false
  return isAfter(startOfDay(new Date()), startOfDay(parseISO(dueDate)))
}

export function calculateDueDates(
  releaseDate: string,
  templates: TaskTemplate[]
): Record<number, Date | null> {
  const release = parseISO(releaseDate)
  const dueDaysValues = templates.map(t => t.dueDays).filter((d): d is number => d !== null)
  const maxDays = Math.max(...dueDaysValues, 0)

  const result: Record<number, Date | null> = {}
  for (const t of templates) {
    if (t.dueDays === null) {
      result[t.id] = null
    } else {
      // due_date = release_date - (max_days - task.dueDays) days
      const d = subDays(release, maxDays - t.dueDays)
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

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { parseISO, format, isAfter, startOfDay } from 'date-fns'
import { TaskStatus } from './types'

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

// Returns the browser's current timezone abbreviation (e.g. "EDT", "EEST", "COT").
// Used by formatDateWithTZ below when baking a date string into Slack/notification
// content that other people in other timezones will read.
export function getCurrentTimezoneAbbr(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'short',
    }).formatToParts(date)
    return parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

// Same as formatDate but appends the browser's timezone abbreviation when
// the value has a time component. Use this when the formatted string is going
// to be persisted (Slack message, notification body) and read by people in
// other timezones who need to know which zone the time refers to.
export function formatDateWithTZ(date: string | Date | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseDate(date) : date
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
  if (!hasTime) return format(d, 'MMM d, yyyy')
  const tz = getCurrentTimezoneAbbr(d)
  const base = format(d, 'MMM d, yyyy · h:mm a')
  return tz ? `${base} ${tz}` : base
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

// ── Workspace-timezone helpers (server-side, used by cron routes) ─────────
// "Today" for deadline reminders should mean the workspace's local day, not
// the server's UTC day. Vercel crons run in UTC; for a workspace east of UTC
// the UTC-based check fires during the previous local evening and misses or
// mistimes tasks due on the local morning. The canonical timezone lives in
// workspace_settings.timezone (cron/unlock code reads it from the DB);
// WORKSPACE_TIMEZONE in Vercel is the fallback. Defaults to UTC.
export function getWorkspaceTimezone(): string {
  return process.env.WORKSPACE_TIMEZONE || 'UTC'
}

// YYYY-MM-DD of `date` in the workspace timezone (lexicographically comparable).
export function workspaceDateString(date: Date = new Date(), tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || getWorkspaceTimezone() }).format(date)
  } catch {
    // Invalid timezone configured — fall back to UTC rather than crash the cron.
    return date.toISOString().slice(0, 10)
  }
}

// Compare a DB date/timestamp against "today" in the workspace timezone.
// Returns -1 (before today / past due), 0 (due today), 1 (in the future).
export function compareToWorkspaceToday(dateStr: string, tz?: string): -1 | 0 | 1 {
  const d = workspaceDateString(parseDate(dateStr), tz)
  const today = workspaceDateString(new Date(), tz)
  return d < today ? -1 : d > today ? 1 : 0
}

// Offset in milliseconds between timezone `tz` and UTC at instant `at`
// (positive when the zone is ahead of UTC).
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value)
  const wallAsUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wallAsUTC - Math.floor(at.getTime() / 1000) * 1000
}

// Convert a wall-clock date+time expressed in timezone `tz` to the
// corresponding UTC instant. Used to compute due dates from a release
// date/time without depending on the server's own timezone.
// Falls back to UTC interpretation if the timezone is invalid.
export function wallTimeInTzToUTC(dateStr: string, timeStr: string, tz: string): Date {
  const naiveUTC = new Date(`${dateStr}T${timeStr}:00Z`).getTime()
  try {
    let utcMs = naiveUTC
    // Two iterations cover DST transitions near the guessed instant.
    for (let i = 0; i < 2; i++) utcMs = naiveUTC - tzOffsetMs(new Date(utcMs), tz)
    return new Date(utcMs)
  } catch {
    return new Date(naiveUTC)
  }
}

// Dedup window for once-daily crons: "already sent within the last 23 hours".
// Timezone-independent (unlike the old startOfDay(server) boundary) and, since
// the cron runs every 24h, guarantees at most one notification per task per day.
export function cronDedupSinceISO(): string {
  return new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()
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

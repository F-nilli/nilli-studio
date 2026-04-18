'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isSameDay,
  addMonths, subMonths, addWeeks, subWeeks,
  isToday, isPast, startOfDay, getHours,
} from 'date-fns'
import type { Task, Episode, User } from '@/lib/types'
import { cn, isOverdue, parseDate } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_TRACKS: { label: string; color: string }[] = [
  { label: 'Long-form',    color: '#f7931a' },
  { label: 'Trailer',      color: '#60a5fa' },
  { label: 'Thumbnails',   color: '#34d399' },
  { label: 'Clips & Shorts', color: '#a78bfa' },
  { label: 'Review',       color: '#fb923c' },
  { label: 'Publishing',   color: '#38bdf8' },
]

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  currentUser: User
  tasks: (Task & { episode: Episode })[]
  episodes: Pick<Episode, 'id' | 'guest_name' | 'client_label' | 'release_date'>[]
  allUsers: User[]
}

type TeamMode = 'my' | 'all'

// ─── Main Component ──────────────────────────────────────────────────────────

export function CalendarClient({ currentUser, tasks, episodes }: Props) {
  const router = useRouter()
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'ops_manager'

  const [viewMode, setViewMode] = useState<'month' | 'week'>('week')
  const [teamMode, setTeamMode] = useState<TeamMode>('my')
  const [currentDate, setCurrentDate] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [expandedDay, setExpandedDay] = useState<Date | null>(null)
  const [tooltipData, setTooltipData] = useState<{ task: Task & { episode?: Episode }; rect: DOMRect } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Load persisted team mode
  useEffect(() => {
    if (!isAdmin) return
    try {
      const saved = localStorage.getItem('cal_team_mode') as TeamMode | null
      if (saved === 'my' || saved === 'all') setTeamMode(saved)
    } catch {}
  }, [isAdmin])

  function handleTeamMode(mode: TeamMode) {
    setTeamMode(mode)
    try { localStorage.setItem('cal_team_mode', mode) } catch {}
  }

  // Close popover on outside click
  useEffect(() => {
    if (!expandedDay) return
    function handle(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setExpandedDay(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [expandedDay])

  // Close tooltip on scroll
  useEffect(() => {
    if (!tooltipData) return
    function handle() { setTooltipData(null) }
    document.addEventListener('scroll', handle, true)
    return () => document.removeEventListener('scroll', handle, true)
  }, [tooltipData])

  // ── Derived data ──────────────────────────────────────────────────────────

  const myTasks = useMemo(
    () => tasks.filter(t => t.assignee_id === currentUser.id),
    [tasks, currentUser.id],
  )

  const activeTasks = isAdmin && teamMode === 'all' ? tasks : myTasks

  const myEpisodeIds = useMemo(
    () => new Set(myTasks.map(t => t.episode_id)),
    [myTasks],
  )

  const activeEpisodes = useMemo(
    () => isAdmin && teamMode === 'all'
      ? episodes
      : episodes.filter(ep => myEpisodeIds.has(ep.id)),
    [isAdmin, teamMode, episodes, myEpisodeIds],
  )

  const legendTracks = useMemo(() => {
    if (isAdmin && teamMode === 'all') return ALL_TRACKS
    const trackSet = new Set(myTasks.map(t => t.track))
    return ALL_TRACKS.filter(t => trackSet.has(t.label as any))
  }, [isAdmin, teamMode, myTasks])

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getTasksForDay(day: Date) {
    return activeTasks.filter(t => t.due_date && isSameDay(parseDate(t.due_date), day))
  }

  function getEpisodesForDay(day: Date) {
    return activeEpisodes.filter(ep => ep.release_date && isSameDay(parseDate(ep.release_date), day))
  }

  function navigatePrev() {
    if (viewMode === 'month') setCurrentDate(d => subMonths(d, 1))
    else setCurrentDate(d => subWeeks(d, 1))
  }

  function navigateNext() {
    if (viewMode === 'month') setCurrentDate(d => addMonths(d, 1))
    else setCurrentDate(d => addWeeks(d, 1))
  }

  function goToToday() {
    const now = new Date()
    if (viewMode === 'month') setCurrentDate(startOfMonth(now))
    else setCurrentDate(startOfWeek(now, { weekStartsOn: 1 }))
  }

  function getHeaderLabel() {
    if (viewMode === 'month') return format(currentDate, 'MMMM yyyy')
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000)
    if (format(weekStart, 'MMM yyyy') === format(weekEnd, 'MMM yyyy')) {
      return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'd, yyyy')}`
    }
    return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`
  }

  function hasTasksInView() {
    if (viewMode === 'month') {
      const s = startOfMonth(currentDate)
      const e = endOfMonth(currentDate)
      return activeTasks.some(t => {
        if (!t.due_date) return false
        const d = parseDate(t.due_date)
        return d >= s && d <= e
      })
    }
    const s = startOfWeek(currentDate, { weekStartsOn: 1 })
    const e = endOfWeek(currentDate, { weekStartsOn: 1 })
    return activeTasks.some(t => {
      if (!t.due_date) return false
      const d = parseDate(t.due_date)
      return d >= s && d <= e
    })
  }

  // ── Month view ────────────────────────────────────────────────────────────

  function renderMonthView() {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
    const days = eachDayOfInterval({ start: calStart, end: calEnd })
    const noTasks = !hasTasksInView()

    return (
      <div className="border border-white/[0.07] rounded-xl overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7" style={{ background: '#1a1a1a' }}>
          {DAY_HEADERS.map(d => (
            <div
              key={d}
              className="py-2 text-center"
              style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            const dayTasks = getTasksForDay(day)
            const dayEpisodes = getEpisodesForDay(day)
            const inMonth = isSameMonth(day, currentDate)
            const today = isToday(day)
            const isPastDay = isPast(startOfDay(day)) && !today

            const cellBg = today ? '#1e1a14' : inMonth ? '#1a1a1a' : '#141414'
            const cellBorder = today ? '1px solid rgba(247,147,26,0.3)' : '1px solid rgba(255,255,255,0.07)'
            const visibleTasks = dayTasks.slice(0, 3)
            const overflowCount = dayTasks.length - 3

            return (
              <div
                key={idx}
                className="relative p-2"
                style={{ minHeight: '110px', background: cellBg, border: cellBorder, borderTop: 'none', borderLeft: 'none' }}
              >
                {/* Date number */}
                {today ? (
                  <div className="w-7 h-7 rounded-full bg-[#f7931a] text-black font-bold flex items-center justify-center text-[13px] mb-1">
                    {format(day, 'd')}
                  </div>
                ) : (
                  <div className={cn('text-[13px] font-medium mb-1', inMonth ? 'text-white/70' : 'text-white/20')}>
                    {format(day, 'd')}
                  </div>
                )}

                {/* Release banners */}
                {dayEpisodes.map(ep => (
                  <a
                    key={ep.id}
                    href={`/episodes/${ep.id}`}
                    className="flex items-center w-full h-[22px] px-1.5 mb-1 rounded-sm text-[11px] font-semibold text-white/90 truncate cursor-pointer hover:brightness-110"
                    style={{ background: 'linear-gradient(to right, rgba(247,147,26,0.3), rgba(247,147,26,0.07))', borderLeft: '3px solid #f7931a' }}
                    title={`${ep.guest_name} — ${ep.client_label}`}
                  >
                    {ep.guest_name}
                  </a>
                ))}

                {/* Task pills */}
                <div className="space-y-0.5">
                  {visibleTasks.map(task => (
                    <TaskPill
                      key={task.id}
                      task={task}
                      isPast={isPastDay}
                      onClick={() => router.push(`/episodes/${task.episode_id}?t=${task.id}`)}
                      onHover={rect => setTooltipData({ task, rect })}
                      onLeave={() => setTooltipData(null)}
                    />
                  ))}
                  {overflowCount > 0 && (
                    <button
                      onClick={() => setExpandedDay(day)}
                      className="text-[11px] font-semibold text-[#f7931a] px-1 hover:underline"
                    >
                      +{overflowCount} more
                    </button>
                  )}
                </div>

                {/* +N more popover */}
                {expandedDay && isSameDay(expandedDay, day) && (
                  <div
                    ref={popoverRef}
                    className="absolute left-0 top-full z-50 w-64 rounded-lg shadow-xl p-3 space-y-1"
                    style={{ background: '#232323', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2">
                      {format(day, 'EEEE, MMM d')}
                    </p>
                    {dayTasks.map(task => (
                      <button
                        key={task.id}
                        onClick={() => { setExpandedDay(null); router.push(`/episodes/${task.episode_id}?t=${task.id}`) }}
                        className="w-full text-left flex flex-col gap-0.5 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors"
                      >
                        <span className="text-[12px] font-medium text-white truncate">{task.label}</span>
                        <span className="text-[10px] text-white/40 truncate">{(task as any).episode?.guest_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Empty state */}
        {noTasks && (
          <div className="py-14 text-center border-t border-white/[0.05]">
            <p className="text-[13px] text-white/25">No tasks scheduled for this period</p>
          </div>
        )}
      </div>
    )
  }

  // ── Week view ─────────────────────────────────────────────────────────────

  function renderWeekView() {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekDays = eachDayOfInterval({ start: weekStart, end: new Date(weekStart.getTime() + 6 * 86400000) })
    const hours = Array.from({ length: 16 }, (_, i) => i + 7) // 7–22
    const noTasks = !hasTasksInView()

    return (
      <div className="border border-white/[0.07] rounded-xl overflow-hidden">
        {/* Column headers */}
        <div className="grid" style={{ gridTemplateColumns: '52px repeat(7, 1fr)', background: '#1a1a1a' }}>
          <div />
          {weekDays.map((day, i) => {
            const today = isToday(day)
            return (
              <div key={i} className="py-2 text-center" style={{ borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {format(day, 'EEE')}
                </span>
                <div className={cn('mx-auto mt-0.5', today ? 'w-7 h-7 rounded-full bg-[#f7931a] flex items-center justify-center' : '')}>
                  <span className={cn('text-[13px] font-bold', today ? 'text-black' : 'text-white/80')}>
                    {format(day, 'd')}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* All-day row: release banners + undated tasks */}
        <div className="grid" style={{ gridTemplateColumns: '52px repeat(7, 1fr)', background: '#181818', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div
            className="flex items-center justify-end pr-2 py-1.5"
            style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', fontWeight: 500 }}
          >
            All day
          </div>
          {weekDays.map((day, i) => {
            const dayEpisodes = getEpisodesForDay(day)
            const allDayTasks = getTasksForDay(day).filter(t => !t.due_date || getHours(parseDate(t.due_date)) === 0)
            return (
              <div
                key={i}
                className="py-1 px-1 space-y-0.5 min-h-[30px] overflow-hidden min-w-0"
                style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', background: i % 2 === 0 ? '#1a1a1a' : '#181818' }}
              >
                {dayEpisodes.map(ep => (
                  <a
                    key={ep.id}
                    href={`/episodes/${ep.id}`}
                    className="flex items-center w-full h-[20px] px-1.5 rounded-sm text-[10px] font-semibold text-white/90 truncate cursor-pointer hover:brightness-110"
                    style={{ background: 'linear-gradient(to right, rgba(247,147,26,0.3), rgba(247,147,26,0.07))', borderLeft: '3px solid #f7931a' }}
                    title={`${ep.guest_name} — ${ep.client_label}`}
                  >
                    {ep.guest_name}
                  </a>
                ))}
                {allDayTasks.map(task => (
                  <TaskPill
                    key={task.id}
                    task={task}
                    weekView
                    onClick={() => router.push(`/episodes/${task.episode_id}?t=${task.id}`)}
                    onHover={rect => setTooltipData({ task, rect })}
                    onLeave={() => setTooltipData(null)}
                  />
                ))}
              </div>
            )
          })}
        </div>

        {/* Time grid */}
        <div className="overflow-auto" style={{ maxHeight: '620px' }}>
          {hours.map(hour => (
            <div key={hour} className="grid" style={{ gridTemplateColumns: '52px repeat(7, 1fr)', height: '64px' }}>
              <div
                className="flex items-start justify-end pr-2 pt-1"
                style={{ color: 'rgba(255,255,255,0.22)', fontSize: '10px', fontWeight: 500 }}
              >
                {hour}:00
              </div>
              {weekDays.map((day, colIdx) => {
                const colBg = colIdx % 2 === 0 ? '#1a1a1a' : '#181818'
                const dayTasksAtHour = getTasksForDay(day).filter(t => {
                  if (!t.due_date) return false
                  const h = getHours(parseDate(t.due_date))
                  return h !== 0 && Math.max(7, Math.min(22, h)) === hour
                })
                return (
                  <div
                    key={colIdx}
                    className="relative p-0.5 space-y-0.5 overflow-hidden min-w-0"
                    style={{ background: colBg, borderLeft: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    {dayTasksAtHour.map(task => (
                      <TaskPill
                        key={task.id}
                        task={task}
                        weekView
                        onClick={() => router.push(`/episodes/${task.episode_id}?t=${task.id}`)}
                        onHover={rect => setTooltipData({ task, rect })}
                        onLeave={() => setTooltipData(null)}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Empty state */}
        {noTasks && (
          <div className="py-14 text-center space-y-1.5 border-t border-white/[0.05]">
            <p className="text-[13px] text-white/25">No tasks scheduled for this period</p>
            {teamMode === 'my' && (
              <p className="text-[12px] text-white/15">New tasks will appear here once they are assigned to you</p>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Floating tooltip */}
      {tooltipData && (
        <TaskTooltip task={tooltipData.task} rect={tooltipData.rect} />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Left: team + view toggles */}
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (
            <div className="flex rounded-lg overflow-hidden border border-white/10">
              {(['my', 'all'] as TeamMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => handleTeamMode(mode)}
                  className={cn(
                    'px-3 h-8 text-[12px] font-semibold transition-colors',
                    teamMode === mode
                      ? 'bg-[#f7931a] text-black'
                      : 'text-white/50 hover:text-white hover:bg-white/5',
                  )}
                >
                  {mode === 'my' ? 'My Tasks' : 'All Team'}
                </button>
              ))}
            </div>
          )}

          <div className="flex rounded-lg overflow-hidden border border-white/10">
            {(['week', 'month'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'px-3 h-8 text-[12px] font-semibold transition-colors capitalize',
                  viewMode === mode ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white hover:bg-white/5',
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {/* Center: navigation */}
        <div className="flex items-center gap-1 mx-auto">
          <button
            onClick={navigatePrev}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/5 transition-colors text-white/60 hover:text-white"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[16px] font-bold text-white min-w-[180px] text-center">
            {getHeaderLabel()}
          </span>
          <button
            onClick={navigateNext}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/5 transition-colors text-white/60 hover:text-white"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToToday}
            className="ml-1 px-3 h-8 rounded-lg text-[12px] font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-colors border border-white/10"
          >
            Today
          </button>
        </div>

        {/* Right: legend */}
        {legendTracks.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap shrink-0">
            {legendTracks.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[11px] text-white/45">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Calendar */}
      {viewMode === 'month' ? renderMonthView() : renderWeekView()}
    </div>
  )
}

// ─── Task Pill ────────────────────────────────────────────────────────────────

function TaskPill({
  task,
  onClick,
  onHover,
  onLeave,
  isPast = false,
  weekView = false,
}: {
  task: Task & { episode?: Episode }
  onClick: () => void
  onHover: (rect: DOMRect) => void
  onLeave: () => void
  isPast?: boolean
  weekView?: boolean
}) {
  const overdue = isOverdue(task.due_date, task.status)
  const trackColor = TRACK_COLORS[task.track as keyof typeof TRACK_COLORS] ?? '#888'
  const borderColor = overdue ? '#dc2626' : trackColor
  const bgOpacity = isPast ? 0.07 : overdue ? 0.15 : 0.12
  const bgColor = hexWithOpacity(overdue ? '#dc2626' : trackColor, bgOpacity)

  return (
    <button
      onClick={onClick}
      onMouseEnter={e => onHover((e.currentTarget as HTMLButtonElement).getBoundingClientRect())}
      onMouseLeave={onLeave}
      className="w-full text-left flex items-center gap-1 hover:brightness-110 transition-all cursor-pointer overflow-hidden"
      style={{
        height: weekView ? '32px' : '24px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 500,
        paddingLeft: '6px',
        paddingRight: '4px',
        borderLeft: `3px solid ${borderColor}`,
        background: bgColor,
        color: 'rgba(255,255,255,0.85)',
        opacity: isPast ? 0.5 : 1,
      }}
    >
      <span className="flex-1 min-w-0 truncate">{task.label}</span>
      {task.assignee && (
        <span
          className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white ml-1"
          style={{ backgroundColor: task.assignee.avatar_color ?? '#888' }}
        >
          {task.assignee.name?.[0] ?? '?'}
        </span>
      )}
    </button>
  )
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  locked: 'Locked', ready: 'Ready', in_progress: 'In Progress',
  in_review: 'In Review', approved: 'Approved', revision: 'Revision', done: 'Done',
}

const STATUS_COLORS: Record<string, string> = {
  locked: '#555', ready: '#60a5fa', in_progress: '#f7931a',
  in_review: '#fbbf24', approved: '#34d399', revision: '#ef4444', done: '#34d399',
}

function TaskTooltip({ task, rect }: { task: Task & { episode?: Episode }; rect: DOMRect }) {
  const color = STATUS_COLORS[task.status] ?? '#888'
  const label = STATUS_LABELS[task.status] ?? task.status
  const due = task.due_date ? parseDate(task.due_date) : null
  const hasTime = due && getHours(due) !== 0

  return (
    <div
      style={{
        position: 'fixed',
        left: `${rect.left + rect.width / 2}px`,
        top: `${rect.top - 10}px`,
        transform: 'translate(-50%, -100%)',
        zIndex: 9999,
        background: '#2a2a2a',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '8px',
        padding: '8px 10px',
        minWidth: '180px',
        maxWidth: '260px',
        pointerEvents: 'none',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <p className="text-[13px] font-semibold text-white leading-snug mb-1.5">{task.label}</p>
      <span
        className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
        style={{ background: hexWithOpacity(color, 0.15), color }}
      >
        {label}
      </span>
      {due && (
        <p className="text-[11px] text-white/40 mt-1.5">
          {format(due, 'MMM d, yyyy')}
          {hasTime && <> · {format(due, 'h:mm a')}</>}
        </p>
      )}
      {task.assignee?.name && (
        <p className="text-[11px] text-white/40 mt-0.5">{task.assignee.name}</p>
      )}
    </div>
  )
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function hexWithOpacity(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { User } from '@/lib/types'
import { cn } from '@/lib/utils'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const TRACKS = ['Long-form', 'Trailer', 'Thumbnails', 'Clips & Shorts', 'Review', 'Publishing'] as const

const TRACK_COLORS: Record<string, string> = {
  'Long-form':    '#f7931a',
  'Trailer':      '#60a5fa',
  'Thumbnails':   '#a78bfa',
  'Clips & Shorts': '#34d399',
  'Review':       '#f87171',
  'Publishing':   '#fbbf24',
}

interface MonthMetrics {
  month: string        // 'YYYY-MM'
  label: string        // 'Jan 2026'
  completed: number    // tasks completed as assignee
  reviewed: number     // tasks reviewed as approver
  byTrack: Record<string, { completed: number; reviewed: number }>
}

export function WorkloadMetricsCard({ allUsers: propUsers }: { allUsers?: User[] }) {
  const supabase = createClient()

  const [open, setOpen] = useState(false)
  const [allUsers, setAllUsers] = useState<User[]>(propUsers ?? [])
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [metrics, setMetrics] = useState<MonthMetrics | null>(null)
  const [trend, setTrend] = useState<{ label: string; completed: number; reviewed: number }[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch users if not passed in
  useEffect(() => {
    if (propUsers && propUsers.length > 0) return
    supabase
      .from('users')
      .select('id, name, role, avatar_color, avatar_url')
      .order('name')
      .then(({ data }) => {
        if (data) setAllUsers(data as User[])
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Default selection to first user once list is loaded
  useEffect(() => {
    if (!selectedUserId && allUsers.length > 0) {
      setSelectedUserId(allUsers[0].id)
    }
  }, [allUsers, selectedUserId])

  // Helper: compute completed + reviewed counts from raw history rows + task map
  const computeCounts = useCallback((
    rows: { task_id: string; to_status: string; changed_by: string }[],
    taskMap: Record<string, { assignee_id: string | null; track: string }>,
    userId: string
  ) => {
    const completedTaskIds = new Set<string>()
    const reviewedTaskIds = new Set<string>()
    const byTrack: Record<string, { completed: number; reviewed: number }> = {}

    for (const row of rows) {
      const task = taskMap[row.task_id]
      if (!task) continue
      const track = task.track ?? 'Other'
      if (!byTrack[track]) byTrack[track] = { completed: 0, reviewed: 0 }

      if (task.assignee_id === userId && (row.to_status === 'done' || row.to_status === 'approved') && !completedTaskIds.has(row.task_id)) {
        completedTaskIds.add(row.task_id)
        byTrack[track].completed++
      }
      if (row.changed_by === userId && (row.to_status === 'approved' || row.to_status === 'revision') && task.assignee_id !== userId && !reviewedTaskIds.has(row.task_id)) {
        reviewedTaskIds.add(row.task_id)
        byTrack[track].reviewed++
      }
    }
    return { completed: completedTaskIds.size, reviewed: reviewedTaskIds.size, byTrack }
  }, [])

  const fetchMetrics = useCallback(async (userId: string, month: Date) => {
    setLoading(true)
    const monthStart = startOfMonth(month).toISOString()
    const monthEnd = endOfMonth(month).toISOString()

    // Step 1: fetch history rows for this month (no join)
    const { data: history } = await supabase
      .from('task_history')
      .select('task_id, to_status, changed_by')
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd)
      .in('to_status', ['done', 'approved', 'revision'])

    if (!history || history.length === 0) {
      setMetrics({ month: format(month, 'yyyy-MM'), label: format(month, 'MMMM yyyy'), completed: 0, reviewed: 0, byTrack: {} })
      setLoading(false)
      // Still build trend
    } else {
      // Step 2: fetch task metadata for unique task_ids
      const taskIds = [...new Set(history.map(r => r.task_id))]
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, assignee_id, track')
        .in('id', taskIds)

      const taskMap: Record<string, { assignee_id: string | null; track: string }> = {}
      for (const t of tasks ?? []) taskMap[t.id] = { assignee_id: t.assignee_id, track: t.track }

      const { completed, reviewed, byTrack } = computeCounts(history, taskMap, userId)
      setMetrics({ month: format(month, 'yyyy-MM'), label: format(month, 'MMMM yyyy'), completed, reviewed, byTrack })
    }

    // Build 6-month trend (same two-step approach)
    const trendMonths = Array.from({ length: 6 }, (_, i) => subMonths(month, 5 - i))
    const trendData = await Promise.all(trendMonths.map(async m => {
      const mStart = startOfMonth(m).toISOString()
      const mEnd = endOfMonth(m).toISOString()
      const { data: h } = await supabase
        .from('task_history')
        .select('task_id, to_status, changed_by')
        .gte('created_at', mStart)
        .lte('created_at', mEnd)
        .in('to_status', ['done', 'approved', 'revision'])

      if (!h || h.length === 0) return { label: format(m, 'MMM'), completed: 0, reviewed: 0 }

      const tIds = [...new Set(h.map(r => r.task_id))]
      const { data: tTasks } = await supabase.from('tasks').select('id, assignee_id, track').in('id', tIds)
      const tMap: Record<string, { assignee_id: string | null; track: string }> = {}
      for (const t of tTasks ?? []) tMap[t.id] = { assignee_id: t.assignee_id, track: t.track }

      const { completed: c, reviewed: r } = computeCounts(h, tMap, userId)
      return { label: format(m, 'MMM'), completed: c, reviewed: r }
    }))

    setTrend(trendData)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (!open || !selectedUserId) return
    fetchMetrics(selectedUserId, currentMonth)
  }, [open, selectedUserId, currentMonth, fetchMetrics])

  const selectedUser = allUsers.find(u => u.id === selectedUserId)

  const prevMonth = () => setCurrentMonth(m => subMonths(m, 1))
  const nextMonth = () => {
    const next = subMonths(new Date(), -1)
    setCurrentMonth(m => {
      const proposed = new Date(m.getFullYear(), m.getMonth() + 1, 1)
      return proposed > startOfMonth(next) ? m : proposed
    })
  }
  const isCurrentMonth = format(currentMonth, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  const activeTrackKeys = TRACKS.filter(t => (metrics?.byTrack[t]?.completed ?? 0) + (metrics?.byTrack[t]?.reviewed ?? 0) > 0)

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid rgba(255,255,255,0.07)', background: '#161616' }}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-semibold text-[#888] uppercase tracking-[0.08em]">
            Monthly Workload
          </span>
          {!open && selectedUser && (
            <div className="flex items-center gap-1.5">
              <Avatar name={selectedUser.name} color={selectedUser.avatar_color} size="sm" avatarUrl={selectedUser.avatar_url} />
              <span className="text-xs text-[#555]">{selectedUser.name.split(' ')[0]}</span>
            </div>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-[#555]" /> : <ChevronDown className="w-4 h-4 text-[#555]" />}
      </button>

      {/* Expanded content */}
      {open && (
        <div className="px-5 pb-6 space-y-6">
          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-4">
            {/* User picker */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#555]">Member</span>
              <select
                value={selectedUserId}
                onChange={e => setSelectedUserId(e.target.value)}
                className="bg-[#1e1e1e] border border-[#2e2e2e] text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#ff3c00] cursor-pointer"
              >
                {allUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            {/* Month nav */}
            <div className="flex items-center gap-1 ml-auto">
              <button onClick={prevMonth} className="p-1 rounded hover:bg-white/5 text-[#555] hover:text-[#aaa] transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-white w-28 text-center">{format(currentMonth, 'MMMM yyyy')}</span>
              <button onClick={nextMonth} disabled={isCurrentMonth} className="p-1 rounded hover:bg-white/5 text-[#555] hover:text-[#aaa] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-[#555] text-sm">Loading…</div>
          ) : metrics ? (
            <>
              {/* Summary numbers */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-4" style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[11px] text-[#555] uppercase tracking-wider mb-1">Completed</p>
                  <p className="text-3xl font-black text-white">{metrics.completed}</p>
                  <p className="text-[11px] text-[#555] mt-0.5">tasks as assignee</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[11px] text-[#555] uppercase tracking-wider mb-1">Reviewed</p>
                  <p className="text-3xl font-black text-white">{metrics.reviewed}</p>
                  <p className="text-[11px] text-[#555] mt-0.5">tasks as approver</p>
                </div>
              </div>

              {/* Track breakdown */}
              {activeTrackKeys.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-[#555] uppercase tracking-wider">By Track</p>
                  <div className="space-y-2">
                    {activeTrackKeys.map(track => {
                      const c = metrics.byTrack[track]?.completed ?? 0
                      const r = metrics.byTrack[track]?.reviewed ?? 0
                      const total = metrics.completed + metrics.reviewed || 1
                      const trackTotal = c + r
                      const pct = Math.round((trackTotal / total) * 100)
                      return (
                        <div key={track}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TRACK_COLORS[track] ?? '#888' }} />
                              <span className="text-xs text-[#aaa]">{track}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-[#666]">
                              {c > 0 && <span>{c} done</span>}
                              {r > 0 && <span>{r} reviewed</span>}
                              <span className="text-[#444]">{pct}%</span>
                            </div>
                          </div>
                          <div className="w-full h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: TRACK_COLORS[track] ?? '#888' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {metrics.completed === 0 && metrics.reviewed === 0 && (
                <p className="text-sm text-[#555] text-center py-4">No activity recorded for this month yet.</p>
              )}

              {/* 6-month trend */}
              {trend.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-[#555] uppercase tracking-wider">6-Month Trend</p>
                  <div style={{ height: 120 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trend} barSize={14} barGap={2}>
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: '#555' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis hide allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: '#888' }}
                          itemStyle={{ color: '#ccc' }}
                          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                        />
                        <Bar dataKey="completed" name="Completed" stackId="a" fill="#f7931a" radius={[0, 0, 0, 0]}>
                          {trend.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={format(currentMonth, 'MMM') === entry.label ? '#f7931a' : '#f7931a66'}
                            />
                          ))}
                        </Bar>
                        <Bar dataKey="reviewed" name="Reviewed" stackId="a" fill="#60a5fa" radius={[3, 3, 0, 0]}>
                          {trend.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={format(currentMonth, 'MMM') === entry.label ? '#60a5fa' : '#60a5fa55'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center gap-4 justify-center">
                    <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#f7931a' }} /><span className="text-[10px] text-[#666]">Completed</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#60a5fa' }} /><span className="text-[10px] text-[#666]">Reviewed</span></div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

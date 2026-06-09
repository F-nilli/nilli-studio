'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { User } from '@/lib/types'
import { cn } from '@/lib/utils'
import { format, startOfMonth, subMonths } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const TRACKS = ['Long-form', 'Trailer', 'Thumbnails', 'Clips & Shorts', 'Review', 'Publishing', 'Client Action'] as const

const TRACK_COLORS: Record<string, string> = {
  'Long-form':      '#f7931a',
  'Trailer':        '#60a5fa',
  'Thumbnails':     '#a78bfa',
  'Clips & Shorts': '#34d399',
  'Review':         '#f87171',
  'Publishing':     '#fbbf24',
  'Client Action':  '#e879f9',
}

interface MonthMetrics {
  month: string
  label: string
  completed: number
  reviewed: number
  byTrack: Record<string, { completed: number; reviewed: number }>
  trend: { label: string; month: string; completed: number; reviewed: number }[]
}

export function WorkloadMetricsCard({ allUsers: propUsers }: { allUsers?: User[] }) {
  const supabase = createClient()

  const [open, setOpen] = useState(false)
  const [allUsers, setAllUsers] = useState<User[]>(propUsers ?? [])
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [metrics, setMetrics] = useState<MonthMetrics | null>(null)
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

  // Filter to non-admin users only, Ali first
  const visibleUsers = allUsers
    .filter(u => u.role !== 'admin')
    .sort((a, b) => {
      if (a.name.toLowerCase() === 'ali') return -1
      if (b.name.toLowerCase() === 'ali') return 1
      return a.name.localeCompare(b.name)
    })

  // Default to Ali (or first non-admin) once list is loaded
  useEffect(() => {
    if (!selectedUserId && visibleUsers.length > 0) {
      setSelectedUserId(visibleUsers[0].id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers])

  const fetchMetrics = useCallback(async (userId: string, month: Date) => {
    setLoading(true)
    const monthParam = format(month, 'yyyy-MM')
    try {
      const res = await fetch(`/api/workload?userId=${userId}&month=${monthParam}`)
      if (!res.ok) throw new Error('Failed to fetch workload')
      const data = await res.json()
      setMetrics({
        month: monthParam,
        label: format(month, 'MMMM yyyy'),
        completed: data.completed,
        reviewed: data.reviewed,
        byTrack: data.byTrack ?? {},
        trend: data.trend ?? [],
      })
    } catch {
      setMetrics(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!open || !selectedUserId) return
    fetchMetrics(selectedUserId, currentMonth)
  }, [open, selectedUserId, currentMonth, fetchMetrics])

  const selectedUser = visibleUsers.find(u => u.id === selectedUserId)

  const prevMonth = () => setCurrentMonth(m => subMonths(m, 1))
  const nextMonth = () => {
    setCurrentMonth(m => {
      const proposed = new Date(m.getFullYear(), m.getMonth() + 1, 1)
      return proposed > startOfMonth(new Date()) ? m : proposed
    })
  }
  const isCurrentMonth = format(currentMonth, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  const activeTrackKeys = TRACKS.filter(t =>
    (metrics?.byTrack[t]?.completed ?? 0) + (metrics?.byTrack[t]?.reviewed ?? 0) > 0
  )

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid rgba(255,255,255,0.07)', background: '#161616' }}
    >
      {/* Header */}
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
          {/* Controls: pills + month nav */}
          <div className="space-y-3">
            {/* Member pills */}
            <div className="flex flex-wrap gap-2">
              {visibleUsers.map(u => {
                const isSelected = u.id === selectedUserId
                return (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUserId(u.id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer',
                      isSelected
                        ? 'text-white'
                        : 'text-[#555] hover:text-[#888] hover:bg-white/5'
                    )}
                    style={isSelected ? {
                      background: `${u.avatar_color}22`,
                      border: `1px solid ${u.avatar_color}66`,
                      color: u.avatar_color,
                    } : {
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.07)',
                    }}
                  >
                    <Avatar name={u.name} color={u.avatar_color} size="sm" avatarUrl={u.avatar_url} />
                    {u.name.split(' ')[0]}
                  </button>
                )
              })}
            </div>

            {/* Month nav */}
            <div className="flex items-center gap-1">
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
                  <div className="space-y-2.5">
                    {activeTrackKeys.map(track => {
                      const c = metrics.byTrack[track]?.completed ?? 0
                      const r = metrics.byTrack[track]?.reviewed ?? 0
                      const total = (metrics.completed + metrics.reviewed) || 1
                      const pct = Math.round(((c + r) / total) * 100)
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
              {metrics.trend.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[11px] text-[#555] uppercase tracking-wider">6-Month Trend</p>
                  <div style={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={metrics.trend} barSize={28} barCategoryGap="20%">
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: '#555' }}
                          axisLine={false}
                          tickLine={false}
                          dy={6}
                        />
                        <YAxis hide allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: '#aaa', fontWeight: 600 }}
                          itemStyle={{ color: '#ccc' }}
                          cursor={{ fill: 'rgba(255,255,255,0.04)', radius: 4 }}
                        />
                        <Bar dataKey="completed" name="Completed" stackId="a" fill="#f7931a">
                          {metrics.trend.map((entry, i) => (
                            <Cell key={i} fill={entry.month === metrics.month ? '#f7931a' : '#f7931a44'} />
                          ))}
                        </Bar>
                        <Bar dataKey="reviewed" name="Reviewed" stackId="a" fill="#60a5fa" radius={[4, 4, 0, 0]}>
                          {metrics.trend.map((entry, i) => (
                            <Cell key={i} fill={entry.month === metrics.month ? '#60a5fa' : '#60a5fa44'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center gap-5 justify-center">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm" style={{ background: '#f7931a' }} />
                      <span className="text-[11px] text-[#666]">Completed</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm" style={{ background: '#60a5fa' }} />
                      <span className="text-[11px] text-[#666]">Reviewed</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-[#555] text-center py-4">Could not load workload data.</p>
          )}
        </div>
      )}
    </div>
  )
}

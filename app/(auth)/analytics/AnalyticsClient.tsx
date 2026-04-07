'use client'

import { useState, useEffect } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import type { User } from '@/lib/types'

type Range = 'month' | 'quarter' | 'half' | 'year' | 'all'

interface OverviewData {
  episodesDelivered: number
  thisMonthCount: number
  avgTurnaround: number | null
  onTimePercent: number | null
  avgRevisionRounds: number | null
}

interface ChartsData {
  monthlyOutput: { label: string; count: number; isCurrent: boolean }[]
  outputByClient: { clientKey: string; clientLabel: string; count: number; color: string }[]
  revisionByClient: { clientKey: string; clientLabel: string; avg: number; color: string }[]
  teamCompletion: {
    userId: string
    name: string
    avatarColor: string
    avatarUrl: string | null
    totalCompleted: number
    onTimePercent: number | null
  }[]
  turnaroundByClient: { clientKey: string; clientLabel: string; avgDays: number; color: string }[]
  insights: { color: 'red' | 'green' | 'amber'; text: string }[]
}

const RANGE_LABELS: Record<Range, string> = {
  month: 'This month',
  quarter: 'Last 3 months',
  half: 'Last 6 months',
  year: 'This year',
  all: 'All time',
}

const RANGES: Range[] = ['month', 'quarter', 'half', 'year', 'all']

const CARD_STYLE: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: '20px 24px',
}

export function AnalyticsClient({ currentUser }: { currentUser: User }) {
  const [range, setRange] = useState<Range>('all')
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [charts, setCharts] = useState<ChartsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/analytics/overview?range=${range}`).then(r => r.json()),
      fetch(`/api/analytics/charts?range=${range}`).then(r => r.json()),
    ]).then(([ov, ch]) => {
      setOverview(ov)
      setCharts(ch)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [range])

  const hasData = overview && overview.episodesDelivered > 0

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div style={{ maxWidth: 1400, width: '100%', margin: '0 auto', padding: '32px 32px 48px' }}>

        {/* ── Header ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: 32, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.2 }}>
              Analytics
            </h1>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>
              Studio performance · {RANGE_LABELS[range]}
            </p>
          </div>

          {/* Range pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RANGES.map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: range === r ? '1px solid rgba(247,147,26,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  background: range === r ? 'rgba(247,147,26,0.12)' : 'rgba(255,255,255,0.04)',
                  color: range === r ? '#f7931a' : 'rgba(255,255,255,0.45)',
                  transition: 'all 150ms',
                }}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>

        {/* ── Metric cards ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <MetricCard
            label="Episodes delivered"
            value={loading ? null : overview ? String(overview.episodesDelivered) : '—'}
            sub={loading ? null : overview ? `+${overview.thisMonthCount} this month` : null}
            subColor="rgba(255,255,255,0.35)"
          />
          <MetricCard
            label="Avg turnaround"
            value={loading ? null : overview?.avgTurnaround != null ? `${overview.avgTurnaround.toFixed(1)}d` : '—'}
            sub="from creation to archive"
            subColor="rgba(255,255,255,0.35)"
          />
          <MetricCard
            label="On-time delivery"
            value={loading ? null : overview?.onTimePercent != null ? `${overview.onTimePercent}%` : '—'}
            sub="released by release date"
            subColor="rgba(255,255,255,0.35)"
            valueColor={
              overview?.onTimePercent != null
                ? overview.onTimePercent >= 80 ? '#34d399'
                : overview.onTimePercent >= 60 ? '#f59e0b'
                : '#ef4444'
                : undefined
            }
          />
          <MetricCard
            label="Avg revision rounds"
            value={loading ? null : overview?.avgRevisionRounds != null ? overview.avgRevisionRounds.toFixed(1) : '—'}
            sub="per episode"
            subColor="rgba(255,255,255,0.35)"
            valueColor={
              overview?.avgRevisionRounds != null
                ? overview.avgRevisionRounds > 2.5 ? '#ef4444'
                : overview.avgRevisionRounds >= 1.5 ? '#f59e0b'
                : '#34d399'
                : undefined
            }
          />
        </div>

        {/* ── Empty state ───────────────────────────────────────── */}
        {!loading && !hasData && (
          <div style={{
            textAlign: 'center',
            padding: '60px 24px',
            color: 'rgba(255,255,255,0.3)',
            ...CARD_STYLE,
            marginBottom: 24,
          }}>
            <p style={{ fontSize: 15, marginBottom: 6 }}>No completed episodes in this period.</p>
            <p style={{ fontSize: 13 }}>Data will appear here as episodes are archived.</p>
          </div>
        )}

        {/* ── Charts row 1: Monthly + Output by client ──────────── */}
        {(loading || hasData) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Monthly output */}
            <div style={CARD_STYLE}>
              <ChartTitle>Episodes delivered per month</ChartTitle>
              {loading ? (
                <SkeletonBar height={180} />
              ) : charts ? (
                <VerticalBarChart
                  data={charts.monthlyOutput}
                  getColor={d => d.isCurrent ? '#f7931a' : 'rgba(247,147,26,0.55)'}
                  getLabel={d => d.label}
                  getValue={d => d.count}
                  height={160}
                  formatValue={v => v > 0 ? String(v) : ''}
                />
              ) : null}
            </div>

            {/* Output by client */}
            <div style={CARD_STYLE}>
              <ChartTitle>Output by client</ChartTitle>
              {loading ? (
                <SkeletonBar height={180} />
              ) : charts && charts.outputByClient.length > 0 ? (
                <HorizontalBarList
                  items={charts.outputByClient.map(c => ({
                    label: c.clientLabel,
                    value: c.count,
                    color: c.color,
                    displayValue: String(c.count),
                  }))}
                />
              ) : (
                <EmptyChart />
              )}
            </div>
          </div>
        )}

        {/* ── Charts row 2: Revisions + Team + Insights ─────────── */}
        {(loading || hasData) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Revision rounds by client */}
            <div style={CARD_STYLE}>
              <ChartTitle>Avg revision rounds by client</ChartTitle>
              {loading ? (
                <SkeletonBar height={160} />
              ) : charts && charts.revisionByClient.length > 0 ? (
                <HorizontalBarList
                  items={charts.revisionByClient.map(c => ({
                    label: c.clientLabel,
                    value: c.avg,
                    color: c.color,
                    displayValue: c.avg.toFixed(1),
                  }))}
                  maxValue={Math.max(3, ...charts.revisionByClient.map(c => c.avg))}
                />
              ) : (
                <EmptyChart text="Revision history will appear once task_history is active" />
              )}
            </div>

            {/* Team task completion */}
            <div style={CARD_STYLE}>
              <ChartTitle>Team task completion</ChartTitle>
              {loading ? (
                <SkeletonBar height={160} />
              ) : charts && charts.teamCompletion.length > 0 ? (
                <TeamCompletionList members={charts.teamCompletion} />
              ) : (
                <EmptyChart />
              )}
            </div>

            {/* Studio insights */}
            <div style={CARD_STYLE}>
              <ChartTitle>Studio insights</ChartTitle>
              {loading ? (
                <SkeletonBar height={160} />
              ) : charts && charts.insights.length > 0 ? (
                <InsightsList insights={charts.insights} />
              ) : (
                <EmptyChart text="Not enough data to generate insights yet" />
              )}
            </div>
          </div>
        )}

        {/* ── Full-width turnaround chart ────────────────────────── */}
        {(loading || hasData) && (
          <div style={CARD_STYLE}>
            <ChartTitle>Avg turnaround by client</ChartTitle>
            {loading ? (
              <SkeletonBar height={180} />
            ) : charts && charts.turnaroundByClient.length > 0 ? (
              <VerticalBarChart
                data={charts.turnaroundByClient}
                getColor={d => d.color}
                getLabel={d => d.clientLabel}
                getValue={d => d.avgDays}
                height={160}
                formatValue={v => `${v.toFixed(1)}d`}
              />
            ) : (
              <EmptyChart />
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function MetricCard({
  label, value, sub, subColor, valueColor,
}: {
  label: string
  value: string | null
  sub?: string | null
  subColor?: string
  valueColor?: string
}) {
  return (
    <div style={CARD_STYLE}>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </p>
      <p style={{ fontSize: 28, fontWeight: 700, color: value === null ? '#333' : (valueColor ?? '#fff'), lineHeight: 1, marginBottom: 8 }}>
        {value === null ? (
          <span style={{ display: 'inline-block', width: 72, height: 28, background: '#2a2a2a', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ) : value}
      </p>
      {sub && (
        <p style={{ fontSize: 12, color: subColor ?? 'rgba(255,255,255,0.4)' }}>{sub}</p>
      )}
    </div>
  )
}

function ChartTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </p>
  )
}

function SkeletonBar({ height }: { height: number }) {
  return (
    <div style={{ height, background: '#222', borderRadius: 6 }} />
  )
}

function EmptyChart({ text = 'No data for this period' }: { text?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100, color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
      {text}
    </div>
  )
}

function VerticalBarChart<T>({
  data, getColor, getLabel, getValue, height, formatValue,
}: {
  data: T[]
  getColor: (d: T) => string
  getLabel: (d: T) => string
  getValue: (d: T) => number
  height: number
  formatValue: (v: number) => string
}) {
  const max = Math.max(...data.map(d => getValue(d)), 1)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: data.length > 8 ? 4 : 8, height: height + 44 }}>
      {data.map((d, i) => {
        const val = getValue(d)
        const barH = val > 0 ? Math.max((val / max) * height, 3) : 0
        return (
          <div
            key={i}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-end',
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4, visibility: val > 0 ? 'visible' : 'hidden' }}>
              {formatValue(val)}
            </span>
            <div
              style={{
                width: '100%',
                height: barH,
                background: getColor(d),
                borderRadius: '3px 3px 0 0',
                minHeight: val > 0 ? 3 : 0,
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.35)',
                marginTop: 6,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              {getLabel(d)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function HorizontalBarList({
  items,
  maxValue,
}: {
  items: { label: string; value: number; color: string; displayValue: string }[]
  maxValue?: number
}) {
  const max = maxValue ?? Math.max(...items.map(i => i.value), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((item, i) => {
        const pct = max > 0 ? (item.value / max) * 100 : 0
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 100,
              fontSize: 12,
              color: 'rgba(255,255,255,0.7)',
              textAlign: 'right',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flexShrink: 0,
            }}>
              {item.label}
            </span>
            <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`,
                height: '100%',
                background: item.color,
                borderRadius: 4,
                minWidth: item.value > 0 ? 4 : 0,
              }} />
            </div>
            <span style={{ width: 32, fontSize: 12, color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>
              {item.displayValue}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TeamCompletionList({
  members,
}: {
  members: {
    userId: string
    name: string
    avatarColor: string
    avatarUrl: string | null
    totalCompleted: number
    onTimePercent: number | null
  }[]
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {members.map(m => {
        const pct = m.onTimePercent
        const badgeColor = pct === null ? '#555'
          : pct >= 90 ? '#34d399'
          : pct >= 70 ? '#f59e0b'
          : '#ef4444'
        const badgeBg = pct === null ? 'rgba(255,255,255,0.05)'
          : pct >= 90 ? 'rgba(52,211,153,0.12)'
          : pct >= 70 ? 'rgba(245,158,11,0.12)'
          : 'rgba(239,68,68,0.12)'

        return (
          <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={m.name} color={m.avatarColor} avatarUrl={m.avatarUrl} size="sm" />
            <span style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.name}
            </span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginRight: 6 }}>
              {m.totalCompleted}
            </span>
            {pct !== null && (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: badgeColor,
                background: badgeBg,
                padding: '2px 7px',
                borderRadius: 10,
                whiteSpace: 'nowrap',
              }}>
                {pct}% on-time
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function InsightsList({ insights }: { insights: { color: 'red' | 'green' | 'amber'; text: string }[] }) {
  const DOT: Record<string, string> = {
    red: '#ef4444',
    green: '#34d399',
    amber: '#f59e0b',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {insights.map((ins, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: DOT[ins.color],
            flexShrink: 0,
            marginTop: 4,
          }} />
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
            {ins.text}
          </span>
        </div>
      ))}
    </div>
  )
}

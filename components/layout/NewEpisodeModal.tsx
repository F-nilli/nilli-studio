'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { User, Client, DbTaskTemplate } from '@/lib/types'
import { cn, fromDatetimeLocal, roundToHour } from '@/lib/utils'
import { subDays, format } from 'date-fns'

// ─── Helpers (same logic as NewEpisodeClient) ─────────────────────────────────

function getDownstreamSeqIds(seqId: number, templates: DbTaskTemplate[]): number[] {
  const result: number[] = []
  const queue = [seqId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const t of templates) {
      if (t.dep_seq_ids.includes(current) && !result.includes(t.seq_id)) {
        result.push(t.seq_id)
        queue.push(t.seq_id)
      }
    }
  }
  return result
}

function calcDueDates(releaseDate: string, templates: DbTaskTemplate[]): Record<number, string> {
  if (!releaseDate || templates.length === 0) return {}
  const release = new Date(releaseDate)
  const releaseHour = release.getHours()
  const fixedTasks = templates.filter(t => t.due_days !== null && !t.due_after_dep_hours)
  if (fixedTasks.length === 0) return {}
  const maxDays = Math.max(...fixedTasks.map(t => t.due_days as number))
  const result: Record<number, string> = {}
  for (const t of fixedTasks) {
    const d = subDays(release, maxDays - (t.due_days as number))
    d.setHours(releaseHour, 0, 0, 0)
    result[t.seq_id] = format(d, "yyyy-MM-dd'T'HH:mm")
  }
  return result
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface CreatedEpisode {
  id: string
  guest_name: string
  client_label: string
}

interface Props {
  currentUser: User
  onClose: () => void
  onSuccess: (episode: CreatedEpisode) => void
}

export function NewEpisodeModal({ currentUser, onClose, onSuccess }: Props) {
  const supabase = createClient()
  const [dataLoading, setDataLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [templates, setTemplates] = useState<DbTaskTemplate[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])

  // Form state
  const [clientId, setClientId] = useState('')
  const [guestName, setGuestName] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [footageUrl, setFootageUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [taskDueDates, setTaskDueDates] = useState<Record<number, string>>({})
  const [selectedTemplateName, setSelectedTemplateName] = useState('Default')

  // Fetch on mount
  useEffect(() => {
    async function load() {
      const [clientsRes, templatesRes, usersRes] = await Promise.all([
        supabase.from('clients').select('*').eq('active', true).order('label'),
        supabase.from('task_templates').select('*, assignee:users!assignee_id(*), approver:users!approver_id(*)').order('seq_id'),
        supabase.from('users').select('*').order('name'),
      ])
      const loaded = (clientsRes.data ?? []) as Client[]
      setClients(loaded)
      setTemplates((templatesRes.data ?? []) as unknown as DbTaskTemplate[])
      setAllUsers((usersRes.data ?? []) as User[])
      if (loaded.length > 0) setClientId(loaded[0].id)
      setDataLoading(false)
    }
    load()
  }, [])

  // Reset template name when client changes
  useEffect(() => {
    const names = [...new Set(templates.filter(t => t.client_id === clientId).map(t => t.template_name || 'Default'))]
    setSelectedTemplateName(names.includes('Default') ? 'Default' : (names[0] || 'Default'))
  }, [clientId])

  const clientPipelineNames = [...new Set(templates.filter(t => t.client_id === clientId).map(t => t.template_name || 'Default'))]
  const selectedClient = clients.find(c => c.id === clientId)
  const clientTemplates = templates.filter(t => t.client_id === clientId && (t.template_name || 'Default') === selectedTemplateName)
  const unlockedTemplates = clientTemplates.filter(t => t.dep_seq_ids.length === 0 && !t.due_after_dep_hours)

  useEffect(() => {
    if (!releaseDate || clientTemplates.length === 0) { setTaskDueDates({}); return }
    setTaskDueDates(calcDueDates(releaseDate, clientTemplates))
  }, [releaseDate, clientId, selectedTemplateName])

  function handleDateChange(seqId: number, newValue: string) {
    const rounded = roundToHour(newValue)
    const oldValue = taskDueDates[seqId]
    if (!oldValue || !rounded) { setTaskDueDates(prev => ({ ...prev, [seqId]: rounded })); return }
    const delta = new Date(rounded).getTime() - new Date(oldValue).getTime()
    const downstream = getDownstreamSeqIds(seqId, clientTemplates).filter(id => {
      const t = clientTemplates.find(t => t.seq_id === id)
      return t && !t.due_after_dep_hours
    })
    setTaskDueDates(prev => {
      const next = { ...prev, [seqId]: rounded }
      for (const id of downstream) {
        if (prev[id]) next[id] = format(new Date(new Date(prev[id]).getTime() + delta), "yyyy-MM-dd'T'HH:mm")
      }
      return next
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClient) return
    setError('')
    setSubmitting(true)

    const { data: episode, error: epError } = await supabase
      .from('episodes')
      .insert({
        client_key: selectedClient.key,
        client_label: selectedClient.label,
        guest_name: guestName,
        release_date: releaseDate.slice(0, 10),
        footage_url: footageUrl || null,
        notes: notes || null,
        template_name: selectedTemplateName,
        created_by: currentUser.id,
      })
      .select().single()

    if (epError || !episode) { setError(epError?.message || 'Failed to create episode'); setSubmitting(false); return }

    const seqIdToDbId: Record<number, string> = {}
    const taskInserts = clientTemplates.map(t => ({
      episode_id: episode.id,
      template_task_id: t.seq_id,
      label: t.label,
      assignee_id: t.assignee_id || currentUser.id,
      track: t.track,
      status: t.dep_seq_ids.length === 0 ? 'in_progress' : 'locked',
      due_date: taskDueDates[t.seq_id] ? fromDatetimeLocal(taskDueDates[t.seq_id]) : null,
      note: t.note || null,
      dep_task_ids: [],
      requires_approval: t.requires_approval || false,
      approver_id: t.requires_approval ? (t.approver_id || null) : null,
      due_after_dep_hours: t.due_after_dep_hours || null,
    }))

    const { data: createdTasks, error: tasksError } = await supabase.from('tasks').insert(taskInserts).select()
    if (tasksError || !createdTasks) { setError(tasksError?.message || 'Failed to create tasks'); setSubmitting(false); return }

    for (const task of createdTasks) seqIdToDbId[task.template_task_id] = task.id
    for (const t of clientTemplates) {
      if (t.dep_seq_ids.length > 0) {
        const depDbIds = t.dep_seq_ids.map(id => seqIdToDbId[id]).filter(Boolean)
        await supabase.from('tasks').update({ dep_task_ids: depDbIds }).eq('id', seqIdToDbId[t.seq_id])
      }
    }
    for (const task of createdTasks) {
      if (task.status === 'ready' && task.assignee_id) {
        await supabase.from('notifications').insert({
          user_id: task.assignee_id, type: 'task_unlocked', title: 'New task started',
          body: `"${task.label}" is now in progress for ${guestName} / ${selectedClient.label}`,
          task_id: task.id, episode_id: episode.id, read: false,
        })
      }
    }

    onSuccess({ id: episode.id, guest_name: guestName, client_label: selectedClient.label })
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const inputStyle = { background: '#222', border: '1px solid rgba(255,255,255,0.1)' }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-[520px] max-h-[88vh] overflow-y-auto rounded-2xl mx-4"
        style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-[16px] font-bold text-white">New Episode</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-[#555] hover:text-white transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {dataLoading ? (
          <div className="px-6 py-12 text-center text-[#555] text-sm">Loading...</div>
        ) : (
          <form onSubmit={handleCreate} className="p-6 space-y-4">
            {error && (
              <div className="bg-[#ff3c00]/10 border border-[#ff3c00]/30 text-[#ff3c00] px-3 py-2 rounded-lg text-sm">{error}</div>
            )}
            {clients.length === 0 ? (
              <p className="text-[#888] text-sm">No active clients. Add clients in Settings first.</p>
            ) : (
              <>
                {/* Client */}
                <div>
                  <label className="block text-[13px] font-medium text-[#aaa] mb-1.5">Client</label>
                  <select value={clientId} onChange={e => setClientId(e.target.value)} className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a]" style={inputStyle}>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>

                {/* Pipeline (if multiple) */}
                {clientPipelineNames.length > 1 && (
                  <div>
                    <label className="block text-[13px] font-medium text-[#aaa] mb-1.5">Pipeline</label>
                    <div className="flex gap-2 flex-wrap">
                      {clientPipelineNames.map(name => (
                        <button key={name} type="button" onClick={() => setSelectedTemplateName(name)}
                          className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                            selectedTemplateName === name ? 'bg-[#f7931a] text-black border-[#f7931a]' : 'text-[#888] border-[#2e2e2e] hover:text-white')}
                          style={selectedTemplateName !== name ? { background: '#222' } : {}}
                        >{name}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Guest Name */}
                <div>
                  <label className="block text-[13px] font-medium text-[#aaa] mb-1.5">Guest Name</label>
                  <input type="text" value={guestName} onChange={e => setGuestName(e.target.value)} required placeholder="e.g. Elon Musk"
                    className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a] placeholder-[#555]" style={inputStyle} />
                </div>

                {/* Release Date */}
                <div>
                  <label className="block text-[13px] font-medium text-[#aaa] mb-1.5">Release Date & Time</label>
                  <input type="datetime-local" value={releaseDate} step="3600"
                    onChange={e => setReleaseDate(roundToHour(e.target.value))} required
                    className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a]" style={inputStyle} />
                </div>

                {/* Footage URL */}
                <div>
                  <label className="block text-[13px] font-medium text-[#aaa] mb-1.5">Footage URL <span className="text-[#555] font-normal">(optional)</span></label>
                  <input type="url" value={footageUrl} onChange={e => setFootageUrl(e.target.value)} placeholder="https://drive.google.com/..."
                    className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a] placeholder-[#555]" style={inputStyle} />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-[13px] font-medium text-[#aaa] mb-1.5">Notes <span className="text-[#555] font-normal">(optional)</span></label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Episode brief, client direction..."
                    className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a] placeholder-[#555] resize-none" style={inputStyle} />
                </div>

                {/* Starting task due dates */}
                {releaseDate && unlockedTemplates.length > 0 && (
                  <div>
                    <p className="text-[13px] font-medium text-[#aaa] mb-1">Starting task due dates</p>
                    <p className="text-xs text-[#555] mb-2">Auto-calculated from release date. Adjust if this episode needs a faster turnaround.</p>
                    <div className="space-y-2">
                      {unlockedTemplates.map(t => {
                        const assignee = allUsers.find(u => u.id === t.assignee_id)
                        return (
                          <div key={t.seq_id} className="rounded-lg px-3 py-2.5" style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.07)' }}>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-sm text-white font-medium truncate">{t.label}</span>
                              <span className="text-xs text-[#555] shrink-0">{assignee?.name || '—'}</span>
                            </div>
                            <input type="datetime-local" step="3600" value={taskDueDates[t.seq_id] || ''} onChange={e => handleDateChange(t.seq_id, e.target.value)}
                              className="w-full px-2 py-1.5 text-white rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-[#f7931a]"
                              style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.07)' }} />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={onClose}
                    className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium text-[#aaa] hover:text-white transition-colors cursor-pointer"
                    style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting}
                    className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold text-black disabled:opacity-50 transition-all hover:scale-[1.01] cursor-pointer"
                    style={{ background: 'linear-gradient(to bottom, #ff9a30, #e8820a)', border: '1px solid #f7931a', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                    {submitting ? 'Creating...' : 'Create Episode'}
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  )
}

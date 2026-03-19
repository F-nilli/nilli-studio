'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { User, Client, DbTaskTemplate } from '@/lib/types'
import { toDatetimeLocal, fromDatetimeLocal } from '@/lib/utils'
import { subDays, parseISO, format } from 'date-fns'

interface Props {
  currentUser: User
  allUsers: User[]
  clients: Client[]
  templates: DbTaskTemplate[]
}

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
  const release = parseISO(releaseDate)
  const dueDaysValues = templates.map(t => t.due_days).filter((d): d is number => d !== null)
  if (dueDaysValues.length === 0) return {}
  const maxDays = Math.max(...dueDaysValues)
  const result: Record<number, string> = {}
  for (const t of templates) {
    if (t.due_days !== null) {
      const d = subDays(release, maxDays - t.due_days)
      d.setHours(9, 0, 0, 0)
      result[t.seq_id] = format(d, "yyyy-MM-dd'T'HH:mm")
    }
  }
  return result
}

export function NewEpisodeClient({ currentUser, allUsers, clients, templates }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [clientId, setClientId] = useState<string>(clients[0]?.id || '')
  const [guestName, setGuestName] = useState('')
  const [releaseDate, setReleaseDate] = useState('') // datetime-local value
  const [footageUrl, setFootageUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskDueDates, setTaskDueDates] = useState<Record<number, string>>({})

  const selectedClient = clients.find(c => c.id === clientId)
  const clientTemplates = templates.filter(t => t.client_id === clientId)
  const unlockedTemplates = clientTemplates.filter(t => t.dep_seq_ids.length === 0)

  useEffect(() => {
    if (!releaseDate || clientTemplates.length === 0) { setTaskDueDates({}); return }
    setTaskDueDates(calcDueDates(releaseDate, clientTemplates))
  }, [releaseDate, clientId])

  function handleDateChange(seqId: number, newValue: string) {
    const oldValue = taskDueDates[seqId]
    if (!oldValue || !newValue) {
      setTaskDueDates(prev => ({ ...prev, [seqId]: newValue }))
      return
    }
    const delta = new Date(newValue).getTime() - new Date(oldValue).getTime()
    const downstream = getDownstreamSeqIds(seqId, clientTemplates)
    setTaskDueDates(prev => {
      const next = { ...prev, [seqId]: newValue }
      for (const id of downstream) {
        if (prev[id]) {
          const shifted = new Date(new Date(prev[id]).getTime() + delta)
          next[id] = format(shifted, "yyyy-MM-dd'T'HH:mm")
        }
      }
      return next
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClient) return
    setError('')
    setLoading(true)

    const { data: episode, error: epError } = await supabase
      .from('episodes')
      .insert({
        client_key: selectedClient.key,
        client_label: selectedClient.label,
        guest_name: guestName,
        release_date: releaseDate.slice(0, 10),
        footage_url: footageUrl || null,
        notes: notes || null,
        created_by: currentUser.id,
      })
      .select().single()

    if (epError || !episode) { setError(epError?.message || 'Failed to create episode'); setLoading(false); return }

    const seqIdToDbId: Record<number, string> = {}

    const taskInserts = clientTemplates.map(template => {
      const rawDate = taskDueDates[template.seq_id]
      return {
        episode_id: episode.id,
        template_task_id: template.seq_id,
        label: template.label,
        assignee_id: template.assignee_id || currentUser.id,
        track: template.track,
        status: template.dep_seq_ids.length === 0 ? 'ready' : 'locked',
        due_date: rawDate ? fromDatetimeLocal(rawDate) : null,
        note: template.note || null,
        dep_task_ids: [],
        requires_approval: template.requires_approval || false,
        approver_id: template.requires_approval ? (template.approver_id || null) : null,
      }
    })

    const { data: createdTasks, error: tasksError } = await supabase.from('tasks').insert(taskInserts).select()
    if (tasksError || !createdTasks) { setError(tasksError?.message || 'Failed to create tasks'); setLoading(false); return }

    for (const task of createdTasks) seqIdToDbId[task.template_task_id] = task.id

    for (const template of clientTemplates) {
      if (template.dep_seq_ids.length > 0) {
        const depDbIds = template.dep_seq_ids.map(depId => seqIdToDbId[depId]).filter(Boolean)
        await supabase.from('tasks').update({ dep_task_ids: depDbIds }).eq('id', seqIdToDbId[template.seq_id])
      }
    }

    for (const task of createdTasks) {
      if (task.status === 'ready' && task.assignee_id) {
        const assignee = allUsers.find(u => u.id === task.assignee_id)
        if (assignee) {
          await supabase.from('notifications').insert({
            user_id: assignee.id, type: 'task_unlocked',
            title: 'New task ready',
            body: `"${task.label}" is ready for ${guestName} / ${selectedClient.label}`,
            task_id: task.id, episode_id: episode.id, read: false,
          })
        }
      }
    }

    router.push(`/episodes/${episode.id}`)
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/board" className="p-2 rounded-md hover:bg-[#1e1e1e] text-[#888]">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-3xl font-black text-white">New Project</h1>
      </div>

      <form onSubmit={handleCreate} className="bg-[#141414] rounded-xl border border-[#2e2e2e] p-6 space-y-5">
        {error && (
          <div className="bg-[#ff3c00]/10 border border-[#ff3c00]/30 text-[#ff3c00] px-3 py-2 rounded-lg text-base">
            {error}
          </div>
        )}

        {clients.length === 0 ? (
          <div className="text-[#888] text-base">No active clients. Add clients in Settings first.</div>
        ) : (
          <>
            <div>
              <label className="block text-base font-medium text-[#ccc] mb-1.5">Client</label>
              <select
                value={clientId} onChange={e => setClientId(e.target.value)}
                className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00]"
              >
                {clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-base font-medium text-[#ccc] mb-1.5">Guest Name</label>
              <input
                type="text" value={guestName} onChange={e => setGuestName(e.target.value)} required
                placeholder="e.g. Elon Musk"
                className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]"
              />
            </div>

            <div>
              <label className="block text-base font-medium text-[#ccc] mb-1.5">Release Date & Time</label>
              <input
                type="datetime-local" value={releaseDate} onChange={e => setReleaseDate(e.target.value)} required
                className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00]"
              />
            </div>

            <div>
              <label className="block text-base font-medium text-[#ccc] mb-1.5">
                Footage URL <span className="text-[#666] font-normal">(optional)</span>
              </label>
              <input
                type="url" value={footageUrl} onChange={e => setFootageUrl(e.target.value)}
                placeholder="https://drive.google.com/..."
                className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]"
              />
            </div>

            <div>
              <label className="block text-base font-medium text-[#ccc] mb-1.5">
                Notes <span className="text-[#666] font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Add episode brief, client direction, or notes for the team..."
                className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555] resize-none"
              />
            </div>

            {/* First task due dates */}
            {releaseDate && unlockedTemplates.length > 0 && (
              <div>
                <p className="text-base font-medium text-[#ccc] mb-2">Due dates for first tasks</p>
                <p className="text-sm text-[#666] mb-3">Downstream tasks will shift automatically.</p>
                <div className="space-y-2">
                  {unlockedTemplates.map(t => {
                    const assignee = allUsers.find(u => u.id === t.assignee_id)
                    return (
                      <div key={t.seq_id} className="bg-[#1e1e1e] rounded-lg px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <span className="text-base text-white font-medium truncate">{t.label}</span>
                          <span className="text-sm text-[#666] shrink-0">{assignee?.name || '—'}</span>
                        </div>
                        <input
                          type="datetime-local"
                          value={taskDueDates[t.seq_id] || ''}
                          onChange={e => handleDateChange(t.seq_id, e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#141414] border border-[#2e2e2e] text-white rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00]"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* All tasks preview */}
            {clientTemplates.length > 0 && (
              <div>
                <p className="text-base font-medium text-[#ccc] mb-2">All tasks ({clientTemplates.length})</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {clientTemplates.map(t => {
                    const assignee = allUsers.find(u => u.id === t.assignee_id)
                    return (
                      <div key={t.seq_id} className="flex items-center gap-2 text-base text-[#888] bg-[#1e1e1e] rounded-md px-3 py-1.5">
                        <span className="text-[#555] text-sm w-5 shrink-0">{t.seq_id}.</span>
                        <span className="flex-1 truncate">{t.label}</span>
                        <span className="text-sm text-[#666] shrink-0">{assignee?.name || '—'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Link href="/board" className="flex-1 py-2.5 px-4 border border-[#2e2e2e] text-[#ccc] font-medium rounded-lg text-base text-center hover:bg-[#1e1e1e] transition-colors">
                Cancel
              </Link>
              <button type="submit" disabled={loading}
                className="flex-1 py-2.5 px-4 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white font-semibold rounded-lg text-base transition-colors"
              >
                {loading ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

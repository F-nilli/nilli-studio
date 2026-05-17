'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { User, Client, DbTaskTemplate, Track } from '@/lib/types'
import { cn, fromDatetimeLocal, roundToHour, getCurrentTimezoneAbbr } from '@/lib/utils'
import { DateHourPicker } from '@/components/ui/DateHourPicker'
import { subDays, format } from 'date-fns'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TRACKS: Track[] = ['Long-form', 'Trailer', 'Thumbnails', 'Clips & Shorts', 'Review', 'Publishing']

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
  const result: Record<number, string> = {}
  for (const t of templates) {
    const days = t.due_days ?? 0
    const d = subDays(release, days)
    d.setHours(releaseHour, 0, 0, 0)
    result[t.seq_id] = format(d, "yyyy-MM-dd'T'HH:mm")
  }
  return result
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreatedEpisode {
  id: string
  guest_name: string
  client_label: string
}

interface CustomTask {
  tmpId: number
  label: string
  track: Track
  assignee_id: string | null
  due_date: string
  dep_tmp_ids: number[]
  requires_approval: boolean
  approver_id: string | null
}

interface Props {
  currentUser: User
  onClose: () => void
  onSuccess: (episode: CreatedEpisode) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

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
  const [manuallyAdjusted, setManuallyAdjusted] = useState<Set<number>>(new Set())
  const [cascadeShifts, setCascadeShifts] = useState<Record<number, number>>({})
  const [releaseDateWarning, setReleaseDateWarning] = useState(false)

  // Custom task builder state
  const [customTasks, setCustomTasks] = useState<CustomTask[]>([
    { tmpId: 1, label: '', track: 'Long-form', assignee_id: null, due_date: '', dep_tmp_ids: [], requires_approval: false, approver_id: null },
  ])
  const [nextTmpId, setNextTmpId] = useState(2)

  // Image upload state
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [imageWarning, setImageWarning] = useState('')
  const imageInputRef = useRef<HTMLInputElement>(null)

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

  const isCustom = selectedTemplateName === 'custom'
  const clientPipelineNames = [...new Set(templates.filter(t => t.client_id === clientId).map(t => t.template_name || 'Default'))]
  const selectedClient = clients.find(c => c.id === clientId)
  const clientTemplates = templates.filter(t => t.client_id === clientId && (t.template_name || 'Default') === selectedTemplateName)
  const unlockedTemplates = clientTemplates.filter(t => t.dep_seq_ids.length === 0)

  useEffect(() => {
    if (!releaseDate || clientTemplates.length === 0) { setTaskDueDates({}); return }
    setTaskDueDates(calcDueDates(releaseDate, clientTemplates))
    setManuallyAdjusted(new Set())
    setCascadeShifts({})
  }, [releaseDate, clientId, selectedTemplateName])

  function addCustomTask() {
    setCustomTasks(prev => [...prev, {
      tmpId: nextTmpId,
      label: '',
      track: 'Long-form',
      assignee_id: null,
      due_date: '',
      dep_tmp_ids: [],
      requires_approval: false,
      approver_id: null,
    }])
    setNextTmpId(n => n + 1)
  }

  function updateCustomTask(idx: number, field: keyof CustomTask, value: unknown) {
    setCustomTasks(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t))
  }

  function removeCustomTask(idx: number) {
    const removedId = customTasks[idx].tmpId
    setCustomTasks(prev => prev
      .filter((_, i) => i !== idx)
      .map(t => ({ ...t, dep_tmp_ids: t.dep_tmp_ids.filter(id => id !== removedId) }))
    )
  }

  function addImageFiles(files: File[]) {
    const MAX_MB = 10
    const typed = files.filter(f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
    const tooBig = typed.filter(f => f.size > MAX_MB * 1024 * 1024)
    const valid = typed.filter(f => f.size <= MAX_MB * 1024 * 1024)
    if (tooBig.length > 0) {
      const names = tooBig.map(f => f.name).join(', ')
      setImageWarning(`${tooBig.length === 1 ? `"${names}" is` : `${tooBig.length} images are`} too large (max 10MB each) and were not added`)
    }
    if (!valid.length) return
    setImageFiles(prev => {
      const all = [...prev, ...valid]
      const totalMB = all.reduce((s, f) => s + f.size, 0) / (1024 * 1024)
      if (!tooBig.length) setImageWarning(totalMB > 50 ? 'Total size is large — consider compressing images' : '')
      return all
    })
    setImagePreviews(prev => [...prev, ...valid.map(f => URL.createObjectURL(f))])
  }

  function removeImageFile(idx: number) {
    URL.revokeObjectURL(imagePreviews[idx])
    setImageFiles(prev => {
      const next = prev.filter((_, i) => i !== idx)
      const totalMB = next.reduce((s, f) => s + f.size, 0) / (1024 * 1024)
      setImageWarning(totalMB > 50 ? 'Total size is large — consider compressing images' : '')
      return next
    })
    setImagePreviews(prev => prev.filter((_, i) => i !== idx))
  }

  function handleDateChange(seqId: number, newValue: string) {
    const rounded = roundToHour(newValue)
    const oldValue = taskDueDates[seqId]
    if (!oldValue || !rounded) { setTaskDueDates(prev => ({ ...prev, [seqId]: rounded })); return }
    const delta = new Date(rounded).getTime() - new Date(oldValue).getTime()
    const downstream = getDownstreamSeqIds(seqId, clientTemplates)
    setTaskDueDates(prev => {
      const next = { ...prev, [seqId]: rounded }
      for (const id of downstream) {
        if (prev[id]) next[id] = format(new Date(new Date(prev[id]).getTime() + delta), "yyyy-MM-dd'T'HH:mm")
      }
      return next
    })
    setManuallyAdjusted(prev => new Set([...prev, seqId]))
    setCascadeShifts(prev => ({ ...prev, [seqId]: downstream.length }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClient) return

    if (isCustom) {
      if (customTasks.length === 0) { setError('Add at least one task'); return }
      if (customTasks.some(t => !t.label.trim())) { setError('All tasks must have a name'); return }
    }

    setError('')
    setSubmitting(true)

    const { data: episode, error: epError } = await supabase
      .from('episodes')
      .insert({
        client_key: selectedClient.key,
        client_label: selectedClient.label,
        guest_name: guestName,
        release_date: releaseDate.slice(0, 10),
        release_time: releaseDate.length >= 13 ? releaseDate.slice(11, 16) : null,
        footage_url: footageUrl || null,
        notes: notes || null,
        template_name: isCustom ? 'custom' : selectedTemplateName,
        created_by: currentUser.id,
      })
      .select().single()

    if (epError || !episode) { setError(epError?.message || 'Failed to create episode'); setSubmitting(false); return }

    if (isCustom) {
      // ── Custom tasks ────────────────────────────────────────────────────────
      const taskInserts = customTasks.map(ct => ({
        episode_id: episode.id,
        template_task_id: ct.tmpId,
        label: ct.label.trim(),
        assignee_id: ct.assignee_id || currentUser.id,
        track: ct.track,
        status: ct.dep_tmp_ids.length === 0 ? 'in_progress' : 'locked',
        due_date: ct.due_date ? fromDatetimeLocal(ct.due_date) : null,
        note: null,
        dep_task_ids: [],
        requires_approval: ct.requires_approval,
        approver_id: ct.requires_approval ? ct.approver_id : null,
      }))

      const { data: createdTasks, error: tasksError } = await supabase.from('tasks').insert(taskInserts).select()
      if (tasksError || !createdTasks) { setError(tasksError?.message || 'Failed to create tasks'); setSubmitting(false); return }

      const tmpIdToDbId: Record<number, string> = {}
      for (const task of createdTasks) tmpIdToDbId[task.template_task_id] = task.id

      for (const ct of customTasks) {
        if (ct.dep_tmp_ids.length > 0) {
          const depDbIds = ct.dep_tmp_ids.map(id => tmpIdToDbId[id]).filter(Boolean)
          if (depDbIds.length > 0) {
            await supabase.from('tasks').update({ dep_task_ids: depDbIds }).eq('id', tmpIdToDbId[ct.tmpId])
          }
        }
      }

      for (const task of createdTasks) {
        if (task.status === 'in_progress' && task.assignee_id) {
          const assignee = allUsers.find(u => u.id === task.assignee_id)
          if (assignee) {
            await supabase.from('notifications').insert({
              user_id: assignee.id, type: 'task_unlocked', title: 'New task started',
              body: `"${task.label}" is now in progress for ${guestName} / ${selectedClient.label}`,
              task_id: task.id, episode_id: episode.id, read: false,
            })
          }
        }
      }
    } else {
      // ── Template tasks ──────────────────────────────────────────────────────
      const seqIdToDbId: Record<number, string> = {}
      const taskInserts = clientTemplates.map(template => {
        const rawDate = taskDueDates[template.seq_id]

        let resolvedApproverId: string | null = null
        if (template.requires_approval && template.approver_id) {
          const val = template.approver_id
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
          if (isUuid) {
            resolvedApproverId = val
          } else {
            const match = allUsers.find(u => u.name.toLowerCase() === val.toLowerCase())
            if (match) resolvedApproverId = match.id
          }
        }

        return {
          episode_id: episode.id,
          template_task_id: template.seq_id,
          label: template.label,
          assignee_id: template.assignee_id || currentUser.id,
          track: template.track,
          status: template.dep_seq_ids.length === 0 ? 'in_progress' : 'locked',
          due_date: rawDate ? fromDatetimeLocal(rawDate) : null,
          note: template.note || null,
          dep_task_ids: [],
          requires_approval: template.requires_approval || false,
          approver_id: resolvedApproverId,
        }
      })

      const { data: createdTasks, error: tasksError } = await supabase.from('tasks').insert(taskInserts).select()
      if (tasksError || !createdTasks) { setError(tasksError?.message || 'Failed to create tasks'); setSubmitting(false); return }

      for (const task of createdTasks) seqIdToDbId[task.template_task_id] = task.id
      for (const template of clientTemplates) {
        if (template.dep_seq_ids.length > 0) {
          const depDbIds = template.dep_seq_ids.map(id => seqIdToDbId[id]).filter(Boolean)
          await supabase.from('tasks').update({ dep_task_ids: depDbIds }).eq('id', seqIdToDbId[template.seq_id])
        }
      }
      for (const task of createdTasks) {
        if (task.status === 'in_progress' && task.assignee_id) {
          const assignee = allUsers.find(u => u.id === task.assignee_id)
          if (assignee) {
            await supabase.from('notifications').insert({
              user_id: assignee.id, type: 'task_unlocked', title: 'New task started',
              body: `"${task.label}" is now in progress for ${guestName} / ${selectedClient.label}`,
              task_id: task.id, episode_id: episode.id, read: false,
            })
          }
        }
      }
    }

    // Upload reference images
    if (imageFiles.length > 0) {
      for (const file of imageFiles) {
        const path = `${episode.id}/${Date.now()}-${file.name}`
        const { error: uploadError } = await supabase.storage.from('episode-references').upload(path, file)
        if (uploadError) continue
        const { data: urlData } = supabase.storage.from('episode-references').getPublicUrl(path)
        await supabase.from('episode_images').insert({
          episode_id: episode.id,
          url: urlData.publicUrl,
          filename: file.name,
          uploaded_by: currentUser.id,
        })
      }
    }

    // Slack notification for new project
    const releaseDateFormatted = releaseDate.length >= 10
      ? new Date(releaseDate.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : ''
    const releaseTimeFormatted = releaseDate.length >= 13
      ? `${new Date(releaseDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ${getCurrentTimezoneAbbr()}`.trim()
      : null
    fetch('/api/slack/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'new_project',
        episodeId: episode.id,
        newDate: releaseDateFormatted,
        newTime: releaseTimeFormatted,
      }),
    }).catch(() => {})

    onSuccess({ id: episode.id, guest_name: guestName, client_label: selectedClient.label })
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const inputStyle = { background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)' }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={cn(
          'w-full max-h-[90vh] overflow-y-auto rounded-2xl mx-4',
          isCustom ? 'max-w-[960px]' : 'max-w-[580px]'
        )}
        style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0 sticky top-0 z-10" style={{ background: '#141414', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-[16px] font-bold text-white">New Project</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-[#555] hover:text-white transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {dataLoading ? (
          <div className="px-6 py-12 text-center text-[#555] text-sm">Loading...</div>
        ) : (
          <form onSubmit={handleCreate} className="p-6 space-y-5">
            {error && (
              <div className="bg-[#ff3c00]/10 border border-[#ff3c00]/30 text-[#ff3c00] px-3 py-2 rounded-lg text-sm">{error}</div>
            )}
            {clients.length === 0 ? (
              <p className="text-[#888] text-sm">No active clients. Add clients in Settings first.</p>
            ) : (
              <>
                {/* Client */}
                <div>
                  <label className="block text-[13px] font-medium text-[#ccc] mb-1.5">Client</label>
                  <select value={clientId} onChange={e => setClientId(e.target.value)}
                    className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a]" style={inputStyle}>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>

                {/* Pipeline / Custom toggle — always visible */}
                <div>
                  <label className="block text-[13px] font-medium text-[#ccc] mb-1.5">Pipeline</label>
                  <div className="flex gap-2 flex-wrap">
                    {clientPipelineNames.map(name => (
                      <button key={name} type="button" onClick={() => setSelectedTemplateName(name)}
                        className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                          selectedTemplateName === name
                            ? 'bg-[#f7931a] text-black border-[#f7931a]'
                            : 'text-[#888] border-[#2e2e2e] hover:text-white')}
                        style={selectedTemplateName !== name ? { background: '#1e1e1e' } : {}}
                      >{name}</button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSelectedTemplateName('custom')}
                      className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                        isCustom
                          ? 'bg-[#f7931a] text-black border-[#f7931a]'
                          : 'text-[#888] border-[#2e2e2e] hover:text-white')}
                      style={!isCustom ? { background: '#1e1e1e' } : {}}
                    >Custom</button>
                  </div>
                </div>

                {/* Project Name */}
                <div>
                  <label className="block text-[13px] font-medium text-[#ccc] mb-1.5">Project Name</label>
                  <input type="text" value={guestName} onChange={e => setGuestName(e.target.value)} required
                    placeholder="e.g. Elon Musk"
                    className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a] placeholder-[#555]" style={inputStyle} />
                </div>

                {/* Release Date */}
                <div>
                  <label className="block text-[13px] font-medium text-[#ccc] mb-1.5">Release Date & Time</label>
                  <DateHourPicker
                    value={releaseDate}
                    onChange={v => {
                      if (manuallyAdjusted.size > 0) {
                        setReleaseDateWarning(true)
                        setTimeout(() => setReleaseDateWarning(false), 4000)
                      }
                      setReleaseDate(v)
                    }}
                    className="w-full"
                  />
                  {releaseDateWarning && (
                    <p className="text-xs text-amber-400 mt-1">Release date changed — task dates have been recalculated.</p>
                  )}
                </div>

                {/* Footage URL */}
                <div>
                  <label className="block text-[13px] font-medium text-[#ccc] mb-1.5">Footage URL <span className="text-[#555] font-normal">(optional)</span></label>
                  <input type="url" value={footageUrl} onChange={e => setFootageUrl(e.target.value)}
                    placeholder="https://drive.google.com/..."
                    className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a] placeholder-[#555]" style={inputStyle} />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-[13px] font-medium text-[#ccc] mb-1.5">Notes <span className="text-[#555] font-normal">(optional)</span></label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                    placeholder="Add episode brief, client direction, or notes for the team..."
                    className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a] placeholder-[#555] resize-none" style={inputStyle} />
                </div>

                {/* Reference Images */}
                <div>
                  <label className="block text-[13px] font-medium text-[#ccc] mb-1">
                    Reference Images <span className="text-[#555] font-normal">(optional)</span>
                  </label>
                  <p className="text-xs text-[#555] mb-2">Upload mood boards, direction examples, or references for the team</p>
                  <div
                    onClick={() => imageInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={e => { e.preventDefault(); setIsDragging(false); addImageFiles(Array.from(e.dataTransfer.files)) }}
                    className="cursor-pointer flex flex-col items-center justify-center gap-1.5 rounded-lg py-5 transition-colors"
                    style={{
                      border: `2px dashed ${isDragging ? 'rgba(247,147,26,0.5)' : 'rgba(255,255,255,0.12)'}`,
                      background: isDragging ? 'rgba(247,147,26,0.04)' : 'transparent',
                    }}
                  >
                    <Upload className="w-5 h-5 text-[#555]" />
                    <p className="text-sm text-[#666]">Drop images here or click to browse</p>
                    <p className="text-xs text-[#444]">JPG, PNG, WebP · Max 10MB per image</p>
                  </div>
                  <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
                    onChange={e => { addImageFiles(Array.from(e.target.files || [])); e.target.value = '' }} />
                  {imageWarning && <p className="text-xs text-amber-400 mt-2">{imageWarning}</p>}
                  {imagePreviews.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto mt-3 pb-1" style={{ scrollbarWidth: 'none' }}>
                      {imagePreviews.map((src, idx) => (
                        <div key={idx} className="relative shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={imageFiles[idx]?.name || 'Preview'}
                            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                          <button type="button" onClick={() => removeImageFile(idx)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#333] border border-[#555] flex items-center justify-center text-[#aaa] hover:text-white hover:bg-[#444] transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Template mode — starting task due dates */}
                {!isCustom && releaseDate && unlockedTemplates.length > 0 && (
                  <div>
                    <p className="text-[13px] font-medium text-[#ccc] mb-1">Starting task due dates</p>
                    <p className="text-xs text-[#555] mb-2">Auto-calculated from release date. Adjust if this episode needs a faster turnaround.</p>
                    <div className="space-y-2">
                      {unlockedTemplates.map(t => {
                        const assignee = allUsers.find(u => u.id === t.assignee_id)
                        const shiftCount = cascadeShifts[t.seq_id]
                        return (
                          <div key={t.seq_id} className="rounded-lg px-3 py-2.5" style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.07)' }}>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-sm text-white font-medium truncate">{t.label}</span>
                              <span className="text-xs text-[#555] shrink-0">{assignee?.name || '—'}</span>
                            </div>
                            <DateHourPicker value={taskDueDates[t.seq_id] || ''} onChange={v => handleDateChange(t.seq_id, v)} className="w-full" />
                            {shiftCount !== undefined && shiftCount > 0 && (
                              <p className="text-xs text-[#888] mt-1">{shiftCount} dependent task{shiftCount !== 1 ? 's' : ''} shifted</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Template mode — all tasks preview */}
                {!isCustom && clientTemplates.length > 0 && (
                  <div>
                    <p className="text-[13px] font-medium text-[#ccc] mb-2">All tasks ({clientTemplates.length})</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {clientTemplates.map(t => {
                        const assignee = allUsers.find(u => u.id === t.assignee_id)
                        return (
                          <div key={t.seq_id} className="flex items-center gap-2 text-sm text-[#888] rounded-md px-3 py-1.5" style={{ background: '#1e1e1e' }}>
                            <span className="text-[#555] text-xs w-5 shrink-0">{t.seq_id}.</span>
                            <span className="flex-1 truncate">{t.label}</span>
                            <span className="text-xs text-[#666] shrink-0">{assignee?.name || '—'}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Custom mode — task builder */}
                {isCustom && (
                  <div>
                    <p className="text-[13px] font-medium text-[#ccc] mb-2">
                      Tasks <span className="text-[#555] font-normal">({customTasks.length})</span>
                    </p>

                    {/* Column headers */}
                    <div className="hidden md:grid gap-2 px-3 pb-1.5 text-[11px] font-medium text-[#555] uppercase tracking-wide"
                      style={{ gridTemplateColumns: '20px minmax(150px,1fr) 110px 130px 160px auto 130px 24px' }}>
                      <span />
                      <span>Task</span>
                      <span>Track</span>
                      <span>Assignee</span>
                      <span>Due Date</span>
                      <span>Deps</span>
                      <span>Approver</span>
                      <span />
                    </div>

                    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                      {customTasks.map((ct, idx) => (
                        <CustomTaskRow
                          key={ct.tmpId}
                          task={ct}
                          idx={idx}
                          allTasks={customTasks}
                          allUsers={allUsers}
                          onUpdate={(field, value) => updateCustomTask(idx, field, value)}
                          onRemove={() => removeCustomTask(idx)}
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={addCustomTask}
                      className="mt-2.5 text-sm text-[#555] hover:text-[#f7931a] transition-colors font-medium"
                    >
                      + Add task
                    </button>
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
                    {submitting ? 'Creating...' : 'Create Project'}
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

// ─── Custom task row ───────────────────────────────────────────────────────────

function CustomTaskRow({ task, idx, allTasks, allUsers, onUpdate, onRemove }: {
  task: CustomTask
  idx: number
  allTasks: CustomTask[]
  allUsers: User[]
  onUpdate: (field: keyof CustomTask, value: unknown) => void
  onRemove: () => void
}) {
  const selectStyle = 'px-2 py-1.5 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a] w-full'
  const borderStyle = { borderColor: 'rgba(255,255,255,0.06)' }

  const depButtons = allTasks.filter((_, i) => i !== idx).map(t => {
    const pos = allTasks.findIndex(a => a.tmpId === t.tmpId) + 1
    const selected = task.dep_tmp_ids.includes(t.tmpId)
    return (
      <button
        key={t.tmpId}
        type="button"
        title={t.label || `Task ${pos}`}
        onClick={() => onUpdate('dep_tmp_ids', selected
          ? task.dep_tmp_ids.filter(id => id !== t.tmpId)
          : [...task.dep_tmp_ids, t.tmpId]
        )}
        className={cn(
          'w-6 h-6 rounded text-xs font-bold transition-colors shrink-0',
          selected ? 'bg-[#f7931a] text-black' : 'bg-[#1e1e1e] text-[#555] hover:text-white border border-[#2e2e2e]'
        )}
      >
        {pos}
      </button>
    )
  })

  const approverSelect = (
    <select
      value={task.requires_approval ? (task.approver_id || '') : ''}
      onChange={e => {
        const val = e.target.value
        onUpdate('requires_approval', val !== '')
        onUpdate('approver_id', val || null)
      }}
      className={selectStyle}
    >
      <option value="">— No approval</option>
      {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select>
  )

  return (
    <>
      {/* Mobile card (< md) */}
      <div className="md:hidden px-3 py-3 border-b" style={borderStyle}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-[#555] font-mono shrink-0">{idx + 1}</span>
          <input
            value={task.label}
            onChange={e => onUpdate('label', e.target.value)}
            placeholder="Task name"
            className="flex-1 px-2 py-1.5 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a] placeholder-[#444]"
          />
          <button type="button" onClick={onRemove} className="p-0.5 text-[#444] hover:text-[#ff3c00] transition-colors shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select value={task.track} onChange={e => onUpdate('track', e.target.value as Track)} className={selectStyle}>
            {TRACKS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={task.assignee_id || ''} onChange={e => onUpdate('assignee_id', e.target.value || null)} className={selectStyle}>
            <option value="">Unassigned</option>
            {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <DateHourPicker value={task.due_date} onChange={v => onUpdate('due_date', v)} className="w-full" />
          {approverSelect}
        </div>
        {depButtons.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#555]">Deps:</span>
            <div className="flex flex-wrap gap-1">{depButtons}</div>
          </div>
        )}
      </div>

      {/* Desktop grid (md+) */}
      <div
        className="hidden md:grid gap-2 px-3 py-2.5 border-b items-center"
        style={{ gridTemplateColumns: '20px minmax(150px,1fr) 110px 130px 160px auto 130px 24px', ...borderStyle }}
      >
        <span className="text-xs text-[#555] font-mono">{idx + 1}</span>
        <input
          value={task.label}
          onChange={e => onUpdate('label', e.target.value)}
          placeholder="Task name"
          className="px-2 py-1.5 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a] w-full placeholder-[#444]"
        />
        <select value={task.track} onChange={e => onUpdate('track', e.target.value as Track)} className={selectStyle}>
          {TRACKS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={task.assignee_id || ''} onChange={e => onUpdate('assignee_id', e.target.value || null)} className={selectStyle}>
          <option value="">Unassigned</option>
          {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <DateHourPicker value={task.due_date} onChange={v => onUpdate('due_date', v)} className="w-full" />
        <div className="flex flex-wrap gap-1 min-w-0">
          {depButtons.length === 0 ? <span className="text-xs text-[#444]">—</span> : depButtons}
        </div>
        {approverSelect}
        <button type="button" onClick={onRemove} className="p-0.5 text-[#444] hover:text-[#ff3c00] transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  )
}

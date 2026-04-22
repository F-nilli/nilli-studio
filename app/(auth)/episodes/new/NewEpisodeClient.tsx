'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Upload, X } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { User, Client, DbTaskTemplate } from '@/lib/types'
import { cn, fromDatetimeLocal, roundToHour } from '@/lib/utils'
import { DateHourPicker } from '@/components/ui/DateHourPicker'
import { subDays, format } from 'date-fns'

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

export function NewEpisodeClient({ currentUser, allUsers, clients, templates }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [clientId, setClientId] = useState<string>(clients[0]?.id || '')
  const [guestName, setGuestName] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [footageUrl, setFootageUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskDueDates, setTaskDueDates] = useState<Record<number, string>>({})
  const [manuallyAdjusted, setManuallyAdjusted] = useState<Set<number>>(new Set())
  const [cascadeShifts, setCascadeShifts] = useState<Record<number, number>>({})
  const [releaseDateWarning, setReleaseDateWarning] = useState(false)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [imageWarning, setImageWarning] = useState('')
  const [uploadToast, setUploadToast] = useState('')
  const imageInputRef = useRef<HTMLInputElement>(null)

  // Multi-template support
  const clientPipelineNames = [...new Set(templates.filter(t => t.client_id === clientId).map(t => t.template_name || 'Default'))]
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>(
    clientPipelineNames.includes('Default') ? 'Default' : (clientPipelineNames[0] || 'Default')
  )

  // Reset template when client changes — always prefer 'Default'
  useEffect(() => {
    const names = [...new Set(templates.filter(t => t.client_id === clientId).map(t => t.template_name || 'Default'))]
    setSelectedTemplateName(names.includes('Default') ? 'Default' : (names[0] || 'Default'))
  }, [clientId])

  const selectedClient = clients.find(c => c.id === clientId)
  const clientTemplates = templates.filter(t => t.client_id === clientId && (t.template_name || 'Default') === selectedTemplateName)
  const unlockedTemplates = clientTemplates.filter(t => t.dep_seq_ids.length === 0)

  useEffect(() => {
    if (!releaseDate || clientTemplates.length === 0) { setTaskDueDates({}); return }
    setTaskDueDates(calcDueDates(releaseDate, clientTemplates))
    setManuallyAdjusted(new Set())
    setCascadeShifts({})
  }, [releaseDate, clientId, selectedTemplateName])

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
    if (!oldValue || !rounded) {
      setTaskDueDates(prev => ({ ...prev, [seqId]: rounded }))
      return
    }
    const delta = new Date(rounded).getTime() - new Date(oldValue).getTime()
    const downstream = getDownstreamSeqIds(seqId, clientTemplates)
    setTaskDueDates(prev => {
      const next = { ...prev, [seqId]: rounded }
      for (const id of downstream) {
        if (prev[id]) {
          const shifted = new Date(new Date(prev[id]).getTime() + delta)
          next[id] = format(shifted, "yyyy-MM-dd'T'HH:mm")
        }
      }
      return next
    })
    setManuallyAdjusted(prev => new Set([...prev, seqId]))
    setCascadeShifts(prev => ({ ...prev, [seqId]: downstream.length }))
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
        release_time: releaseDate.length >= 13 ? releaseDate.slice(11, 16) : null,
        footage_url: footageUrl || null,
        notes: notes || null,
        template_name: selectedTemplateName,
        created_by: currentUser.id,
      })
      .select().single()

    if (epError || !episode) { setError(epError?.message || 'Failed to create episode'); setLoading(false); return }

    const seqIdToDbId: Record<number, string> = {}

    const taskInserts = clientTemplates.map(template => {
      const rawDate = taskDueDates[template.seq_id]

      // Resolve approver_id: the template may store a UUID or a legacy username/name string
      let resolvedApproverId: string | null = null
      if (template.requires_approval && template.approver_id) {
        const val = template.approver_id
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
        if (isUuid) {
          resolvedApproverId = val
        } else {
          const match = allUsers.find(u => u.name.toLowerCase() === val.toLowerCase())
          if (match) {
            resolvedApproverId = match.id
          } else {
            console.warn(`Warning: approver '${val}' not found in users table for task '${template.label}'`)
          }
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
    if (tasksError || !createdTasks) { setError(tasksError?.message || 'Failed to create tasks'); setLoading(false); return }

    for (const task of createdTasks) seqIdToDbId[task.template_task_id] = task.id

    for (const template of clientTemplates) {
      if (template.dep_seq_ids.length > 0) {
        const depDbIds = template.dep_seq_ids.map(depId => seqIdToDbId[depId]).filter(Boolean)
        if (depDbIds.length !== template.dep_seq_ids.length) {
          console.error(`[NewEpisode] dep wiring mismatch for task ${template.seq_id}: expected ${template.dep_seq_ids.length} deps, got ${depDbIds.length}`)
        }
        const taskDbId = seqIdToDbId[template.seq_id]
        if (taskDbId && depDbIds.length > 0) {
          const { error: depErr } = await supabase.from('tasks').update({ dep_task_ids: depDbIds }).eq('id', taskDbId)
          if (depErr) console.error(`[NewEpisode] failed to wire deps for task ${template.seq_id}:`, depErr.message)
        }
      }
    }

    for (const task of createdTasks) {
      if (task.status === 'in_progress' && task.assignee_id) {
        const assignee = allUsers.find(u => u.id === task.assignee_id)
        if (assignee) {
          await supabase.from('notifications').insert({
            user_id: assignee.id, type: 'task_unlocked',
            title: 'New task started',
            body: `"${task.label}" is now in progress for ${guestName} / ${selectedClient.label}`,
            task_id: task.id, episode_id: episode.id, read: false,
          })
        }
      }
    }

    // Upload reference images
    if (imageFiles.length > 0) {
      let failCount = 0
      for (const file of imageFiles) {
        const path = `${episode.id}/${Date.now()}-${file.name}`
        const { error: uploadError } = await supabase.storage
          .from('episode-references')
          .upload(path, file)
        if (uploadError) { failCount++; continue }
        const { data: urlData } = supabase.storage
          .from('episode-references')
          .getPublicUrl(path)
        await supabase.from('episode_images').insert({
          episode_id: episode.id,
          url: urlData.publicUrl,
          filename: file.name,
          uploaded_by: currentUser.id,
        })
      }
      if (failCount > 0) {
        setUploadToast(`${failCount} image${failCount > 1 ? 's' : ''} failed to upload — you can add them from the episode page`)
        await new Promise(r => setTimeout(r, 1500))
      }
    }

    // Slack notification for new project
    const releaseDateFormatted = releaseDate.length >= 10
      ? new Date(releaseDate.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : ''
    const releaseTimeFormatted = releaseDate.length >= 13
      ? new Date(releaseDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
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

            {/* Pipeline selector — only shown when client has multiple templates */}
            {clientPipelineNames.length > 1 && (
              <div>
                <label className="block text-base font-medium text-[#ccc] mb-1.5">Pipeline</label>
                <div className="flex gap-2 flex-wrap">
                  {clientPipelineNames.map(name => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setSelectedTemplateName(name)}
                      className={cn(
                        'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                        selectedTemplateName === name
                          ? 'bg-[#ff3c00] text-white border-[#ff3c00]'
                          : 'bg-[#1e1e1e] text-[#888] border-[#2e2e2e] hover:text-white'
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

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

            {/* Reference Images */}
            <div>
              <label className="block text-base font-medium text-[#ccc] mb-1">
                Reference Images <span className="text-[#666] font-normal">(optional)</span>
              </label>
              <p className="text-sm text-[#555] mb-2">Upload mood boards, direction examples, or references for the team</p>

              {/* Drop zone */}
              <div
                onClick={() => imageInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => {
                  e.preventDefault()
                  setIsDragging(false)
                  addImageFiles(Array.from(e.dataTransfer.files))
                }}
                className="cursor-pointer flex flex-col items-center justify-center gap-1.5 rounded-lg py-6 transition-colors"
                style={{
                  border: `2px dashed ${isDragging ? 'rgba(247,147,26,0.5)' : 'rgba(255,255,255,0.15)'}`,
                  background: isDragging ? 'rgba(247,147,26,0.04)' : 'transparent',
                  borderRadius: 8,
                }}
              >
                <Upload className="w-5 h-5 text-[#555]" />
                <p className="text-sm text-[#666]">Drop images here or click to browse</p>
                <p className="text-xs text-[#444]">JPG, PNG, WebP · Max 10MB per image</p>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={e => {
                  addImageFiles(Array.from(e.target.files || []))
                  e.target.value = ''
                }}
              />

              {/* Warnings */}
              {imageWarning && (
                <p className="text-xs text-amber-400 mt-2">{imageWarning}</p>
              )}

              {/* Thumbnail previews */}
              {imagePreviews.length > 0 && (
                <div className="flex gap-2 overflow-x-auto mt-3 pb-1" style={{ scrollbarWidth: 'none' }}>
                  {imagePreviews.map((src, idx) => (
                    <div key={idx} className="relative shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={imageFiles[idx]?.name || 'Preview'}
                        style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                      />
                      <button
                        type="button"
                        onClick={() => removeImageFile(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#333] border border-[#555] flex items-center justify-center text-[#aaa] hover:text-white hover:bg-[#444] transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Starting task due dates (only fixed D-X tasks, not dynamic +Xhr) */}
            {releaseDate && unlockedTemplates.length > 0 && (
              <div>
                <p className="text-base font-medium text-[#ccc] mb-1">Starting task due dates</p>
                <p className="text-sm text-[#666] mb-3">Auto-calculated from release date. Adjust if this episode needs a faster turnaround.</p>
                <div className="space-y-2">
                  {unlockedTemplates.map(t => {
                    const assignee = allUsers.find(u => u.id === t.assignee_id)
                    const shiftCount = cascadeShifts[t.seq_id]
                    return (
                      <div key={t.seq_id} className="bg-[#1e1e1e] rounded-lg px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <span className="text-base text-white font-medium truncate max-w-[220px]">{t.label.length > 35 ? t.label.slice(0, 35) + '…' : t.label}</span>
                          <span className="text-sm text-[#666] shrink-0">{assignee?.name || '—'}</span>
                        </div>
                        <DateHourPicker
                          value={taskDueDates[t.seq_id] || ''}
                          onChange={v => handleDateChange(t.seq_id, v)}
                          className="w-full"
                        />
                        {shiftCount !== undefined && shiftCount > 0 && (
                          <p className="text-xs text-[#888] mt-1">{shiftCount} dependent task{shiftCount !== 1 ? 's' : ''} shifted</p>
                        )}
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

      {/* Upload failure toast */}
      {uploadToast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl max-w-sm"
          style={{ background: '#1e1e1e', border: '1px solid rgba(245,158,11,0.3)' }}
        >
          <p className="text-sm text-amber-400">{uploadToast}</p>
        </div>
      )}
    </div>
  )
}

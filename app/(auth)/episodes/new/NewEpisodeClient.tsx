'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { User, ClientKey } from '@/lib/types'
import { CLIENT_TEMPLATES } from '@/lib/templates'
import { CLIENT_LABELS } from '@/lib/constants'
import { calculateDueDates } from '@/lib/utils'
import { format } from 'date-fns'

interface Props {
  currentUser: User
  allUsers: User[]
}

export function NewEpisodeClient({ currentUser, allUsers }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [clientKey, setClientKey] = useState<ClientKey>('brandon_gentile')
  const [guestName, setGuestName] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [footageUrl, setFootageUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const clientOptions: ClientKey[] = ['brandon_gentile', 'bitcoin_edge', 'peruvian_bull', 'walker_america', 'youre_the_voice']
  const selectedTemplate = CLIENT_TEMPLATES[clientKey]

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data: episode, error: epError } = await supabase
      .from('episodes')
      .insert({ client_key: clientKey, client_label: CLIENT_LABELS[clientKey], guest_name: guestName, release_date: releaseDate, footage_url: footageUrl || null, created_by: currentUser.id })
      .select().single()

    if (epError || !episode) { setError(epError?.message || 'Failed to create episode'); setLoading(false); return }

    const dueDates = calculateDueDates(releaseDate, selectedTemplate)
    const templateIdToDbId: Record<number, string> = {}

    const taskInserts = selectedTemplate.map(template => {
      const assignee = allUsers.find(u => u.name.toLowerCase() === template.assigneeName.toLowerCase())
      return {
        episode_id: episode.id,
        template_task_id: template.id,
        label: template.label,
        assignee_id: assignee?.id || currentUser.id,
        track: template.track,
        status: template.deps.length === 0 ? 'ready' : 'locked',
        due_date: dueDates[template.id] ? format(dueDates[template.id]!, 'yyyy-MM-dd') : null,
        note: template.note || null,
        dep_task_ids: [],
      }
    })

    const { data: createdTasks, error: tasksError } = await supabase.from('tasks').insert(taskInserts).select()
    if (tasksError || !createdTasks) { setError(tasksError?.message || 'Failed to create tasks'); setLoading(false); return }

    for (const task of createdTasks) templateIdToDbId[task.template_task_id] = task.id

    for (const template of selectedTemplate) {
      if (template.deps.length > 0) {
        const depDbIds = template.deps.map(depId => templateIdToDbId[depId]).filter(Boolean)
        await supabase.from('tasks').update({ dep_task_ids: depDbIds }).eq('id', templateIdToDbId[template.id])
      }
    }

    for (const task of createdTasks) {
      if (task.status === 'ready') {
        const assignee = allUsers.find(u => u.id === task.assignee_id)
        if (assignee) {
          await supabase.from('notifications').insert({
            user_id: assignee.id, type: 'task_unlocked',
            title: 'New task ready',
            body: `"${task.label}" is ready for ${guestName} / ${CLIENT_LABELS[clientKey]}`,
            task_id: task.id, episode_id: episode.id, read: false,
          })
          if (assignee.slack_webhook_url) {
            fetch(assignee.slack_webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `*New task ready*\n"${task.label}" is ready for ${guestName} / ${CLIENT_LABELS[clientKey]}` }) }).catch(() => {})
          }
        }
      }
    }

    router.push(`/episodes/${episode.id}`)
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/board" className="p-2 rounded-md hover:bg-[#2a2a2a] text-[#888]">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-3xl font-black text-white">New Episode</h1>
      </div>

      <form onSubmit={handleCreate} className="bg-[#1e1e1e] rounded-xl border border-[#2e2e2e] p-6 space-y-5">
        {error && (
          <div className="bg-[#ff3c00]/10 border border-[#ff3c00]/30 text-[#ff3c00] px-3 py-2 rounded-lg text-base">
            {error}
          </div>
        )}

        <div>
          <label className="block text-base font-medium text-[#ccc] mb-1.5">Client</label>
          <select
            value={clientKey} onChange={e => setClientKey(e.target.value as ClientKey)}
            className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00]"
          >
            {clientOptions.map(key => <option key={key} value={key}>{CLIENT_LABELS[key]}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-base font-medium text-[#ccc] mb-1.5">Guest Name</label>
          <input
            type="text" value={guestName} onChange={e => setGuestName(e.target.value)} required
            placeholder="e.g. Elon Musk"
            className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]"
          />
        </div>

        <div>
          <label className="block text-base font-medium text-[#ccc] mb-1.5">Release Date</label>
          <input
            type="date" value={releaseDate} onChange={e => setReleaseDate(e.target.value)} required
            className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00]"
          />
        </div>

        <div>
          <label className="block text-base font-medium text-[#ccc] mb-1.5">
            Footage URL <span className="text-[#666] font-normal">(optional)</span>
          </label>
          <input
            type="url" value={footageUrl} onChange={e => setFootageUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="w-full px-3 py-2 bg-[#2a2a2a] border border-[#3a3a3a] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]"
          />
        </div>

        <div>
          <p className="text-base font-medium text-[#ccc] mb-2">Tasks that will be generated ({selectedTemplate.length})</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {selectedTemplate.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-base text-[#888] bg-[#2a2a2a] rounded-md px-3 py-1.5">
                <span className="text-[#555] text-sm w-5 shrink-0">{t.id}.</span>
                <span className="flex-1 truncate">{t.label}</span>
                <span className="text-sm text-[#666] shrink-0">{t.assigneeName}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Link href="/board" className="flex-1 py-2.5 px-4 border border-[#3a3a3a] text-[#ccc] font-medium rounded-lg text-base text-center hover:bg-[#2a2a2a] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={loading}
            className="flex-1 py-2.5 px-4 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white font-semibold rounded-lg text-base transition-colors"
          >
            {loading ? 'Creating...' : 'Create Episode'}
          </button>
        </div>
      </form>
    </div>
  )
}

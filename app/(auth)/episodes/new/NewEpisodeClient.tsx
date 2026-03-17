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

  const clientOptions: ClientKey[] = [
    'brandon_gentile',
    'bitcoin_edge',
    'peruvian_bull',
    'walker_america',
    'youre_the_voice',
  ]

  const selectedTemplate = CLIENT_TEMPLATES[clientKey]

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Create episode
    const { data: episode, error: epError } = await supabase
      .from('episodes')
      .insert({
        client_key: clientKey,
        client_label: CLIENT_LABELS[clientKey],
        guest_name: guestName,
        release_date: releaseDate,
        footage_url: footageUrl || null,
        created_by: currentUser.id,
      })
      .select()
      .single()

    if (epError || !episode) {
      setError(epError?.message || 'Failed to create episode')
      setLoading(false)
      return
    }

    // Calculate due dates
    const dueDates = calculateDueDates(releaseDate, selectedTemplate)

    // Map template IDs to DB task IDs for dependency resolution
    const templateIdToDbId: Record<number, string> = {}

    // Create tasks in order (to resolve deps)
    // First pass: create all tasks and collect their IDs
    const taskInserts = selectedTemplate.map(template => {
      const assignee = allUsers.find(u =>
        u.name.toLowerCase() === template.assigneeName.toLowerCase()
      )

      return {
        episode_id: episode.id,
        template_task_id: template.id,
        label: template.label,
        assignee_id: assignee?.id || currentUser.id,
        track: template.track,
        status: template.deps.length === 0 ? 'ready' : 'locked',
        due_date: dueDates[template.id] ? format(dueDates[template.id]!, 'yyyy-MM-dd') : null,
        note: template.note || null,
        dep_task_ids: [], // Will be updated after all tasks are created
      }
    })

    const { data: createdTasks, error: tasksError } = await supabase
      .from('tasks')
      .insert(taskInserts)
      .select()

    if (tasksError || !createdTasks) {
      setError(tasksError?.message || 'Failed to create tasks')
      setLoading(false)
      return
    }

    // Map template IDs to actual DB IDs
    for (const task of createdTasks) {
      templateIdToDbId[task.template_task_id] = task.id
    }

    // Second pass: update dep_task_ids with real DB IDs
    for (const template of selectedTemplate) {
      if (template.deps.length > 0) {
        const depDbIds = template.deps
          .map(depTemplateId => templateIdToDbId[depTemplateId])
          .filter(Boolean)

        await supabase
          .from('tasks')
          .update({ dep_task_ids: depDbIds })
          .eq('id', templateIdToDbId[template.id])
      }
    }

    // Notify assignees of ready tasks
    for (const task of createdTasks) {
      if (task.status === 'ready') {
        const assignee = allUsers.find(u => u.id === task.assignee_id)
        if (assignee) {
          await supabase.from('notifications').insert({
            user_id: assignee.id,
            type: 'task_unlocked',
            title: 'New task ready',
            body: `"${task.label}" is ready for ${guestName} / ${CLIENT_LABELS[clientKey]}`,
            task_id: task.id,
            episode_id: episode.id,
            read: false,
          })

          // Slack notification
          if (assignee.slack_webhook_url) {
            fetch(assignee.slack_webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: `*New task ready*\n"${task.label}" is ready for ${guestName} / ${CLIENT_LABELS[clientKey]}`,
              }),
            }).catch(() => {})
          }
        }
      }
    }

    router.push(`/episodes/${episode.id}`)
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/board" className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">New Episode</h1>
      </div>

      <form onSubmit={handleCreate} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-5">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Client</label>
          <select
            value={clientKey}
            onChange={e => setClientKey(e.target.value as ClientKey)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {clientOptions.map(key => (
              <option key={key} value={key}>{CLIENT_LABELS[key]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Guest Name</label>
          <input
            type="text"
            value={guestName}
            onChange={e => setGuestName(e.target.value)}
            required
            placeholder="e.g. Elon Musk"
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Release Date</label>
          <input
            type="date"
            value={releaseDate}
            onChange={e => setReleaseDate(e.target.value)}
            required
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Footage URL <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="url"
            value={footageUrl}
            onChange={e => setFootageUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
          />
        </div>

        {/* Task preview */}
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Tasks that will be generated ({selectedTemplate.length})
          </p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {selectedTemplate.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-md px-3 py-1.5">
                <span className="text-gray-400 text-xs w-5 shrink-0">{t.id}.</span>
                <span className="flex-1 truncate">{t.label}</span>
                <span className="text-xs text-gray-400 shrink-0">{t.assigneeName}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Link
            href="/board"
            className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg text-sm text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {loading ? 'Creating...' : 'Create Episode'}
          </button>
        </div>
      </form>
    </div>
  )
}

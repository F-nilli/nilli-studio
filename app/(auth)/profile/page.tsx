'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { User } from '@/lib/types'

const AVATAR_COLORS = [
  '#fbbf24', '#fb923c', '#f7931a', '#60a5fa',
  '#a78bfa', '#f472b6', '#34d399', '#38bdf8',
  '#ef4444', '#10b981', '#6366f1', '#ec4899',
]

export default function ProfilePage() {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [name, setName] = useState('')
  const [avatarColor, setAvatarColor] = useState('#fbbf24')
  const [slackWebhook, setSlackWebhook] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) return
      const { data } = await supabase.from('users').select('*').eq('id', authUser.id).single()
      if (data) {
        setUser(data as User)
        setName(data.name)
        setAvatarColor(data.avatar_color)
        setSlackWebhook(data.slack_webhook_url || '')
      }
    }
    load()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)

    await supabase.from('users').update({
      name,
      avatar_color: avatarColor,
      slack_webhook_url: slackWebhook || null,
    }).eq('id', user.id)

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!user) return (
    <div className="flex items-center justify-center py-16 text-gray-500">Loading...</div>
  )

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Profile</h1>

      <form onSubmit={handleSave} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-5">
        {/* Preview */}
        <div className="flex items-center gap-4 pb-4 border-b border-gray-100 dark:border-gray-800">
          <Avatar name={name || 'You'} color={avatarColor} size="lg" />
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">{name || 'Your name'}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
            <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full mt-1 inline-block capitalize">
              {user.role}
            </span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Display Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Avatar Color</label>
          <div className="flex flex-wrap gap-2">
            {AVATAR_COLORS.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => setAvatarColor(color)}
                className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: color,
                  outline: avatarColor === color ? `3px solid ${color}` : 'none',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Slack Webhook URL
            <span className="text-gray-400 font-normal ml-1 text-xs">(for notifications)</span>
          </label>
          <input
            type="url"
            value={slackWebhook}
            onChange={e => setSlackWebhook(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Set up an incoming webhook in Slack and paste the URL here to receive notifications.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
        >
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}

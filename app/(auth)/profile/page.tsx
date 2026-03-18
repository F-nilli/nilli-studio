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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) return
      const { data } = await supabase.from('users').select('*').eq('id', authUser.id).single()
      if (data) { setUser(data as User); setName(data.name); setAvatarColor(data.avatar_color) }
    }
    load()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    await supabase.from('users').update({ name, avatar_color: avatarColor }).eq('id', user.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!user) return <div className="flex items-center justify-center py-16 text-[#888]">Loading...</div>

  return (
    <div className="max-w-lg">
      <h1 className="text-3xl font-black text-white mb-6">Profile</h1>

      <form onSubmit={handleSave} className="bg-[#141414] rounded-xl border border-[#2e2e2e] p-6 space-y-5">
        <div className="flex items-center gap-4 pb-4 border-b border-[#2e2e2e]">
          <Avatar name={name || 'You'} color={avatarColor} size="lg" />
          <div>
            <p className="font-bold text-white text-lg">{name || 'Your name'}</p>
            <p className="text-base text-[#888]">{user.email}</p>
            <span className="text-sm bg-[#1e1e1e] text-[#888] px-2 py-0.5 rounded-full mt-1 inline-block capitalize">
              {user.role}
            </span>
          </div>
        </div>

        <div>
          <label className="block text-base font-medium text-[#ccc] mb-1.5">Display Name</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)} required
            className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00]"
          />
        </div>

        <div>
          <label className="block text-base font-medium text-[#ccc] mb-2">Avatar Color</label>
          <div className="flex flex-wrap gap-2">
            {AVATAR_COLORS.map(color => (
              <button key={color} type="button" onClick={() => setAvatarColor(color)}
                className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: color, outline: avatarColor === color ? `3px solid ${color}` : 'none', outlineOffset: '2px' }}
              />
            ))}
          </div>
        </div>

        <button type="submit" disabled={saving}
          className="w-full py-2.5 px-4 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white font-semibold rounded-lg text-base transition-colors"
        >
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}

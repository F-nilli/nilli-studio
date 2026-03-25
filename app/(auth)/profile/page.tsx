'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Avatar, PRESET_ICONS } from '@/components/ui/Avatar'
import { User } from '@/lib/types'
import { Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function load() {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) return
      const { data } = await supabase.from('users').select('*').eq('id', authUser.id).single()
      if (data) {
        setUser(data as User)
        setName(data.name)
        setAvatarColor(data.avatar_color)
        setAvatarUrl(data.avatar_url || null)
      }
    }
    load()
  }, [])

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (file.size > 5 * 1024 * 1024) { setUploadError('File must be under 5MB'); return }
    setUploadError('')
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${user.id}/avatar.${ext}`
    const { error } = await supabase.storage.from('Profile Pictures').upload(path, file, { upsert: true })
    if (error) {
      setUploadError('Upload failed. Make sure the Profile Pictures storage bucket exists.')
    } else {
      const { data: { publicUrl } } = supabase.storage.from('Profile Pictures').getPublicUrl(path)
      setAvatarUrl(`${publicUrl}?t=${Date.now()}`)
    }
    setUploading(false)
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '')
    if (!cleanName) { setSaving(false); return }
    setName(cleanName)
    await supabase.from('users').update({
      name: cleanName,
      avatar_color: avatarColor,
      avatar_url: avatarUrl,
    }).eq('id', user.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!user) return <div className="flex items-center justify-center py-16 text-[#888]">Loading...</div>

  const isPhoto = avatarUrl && !avatarUrl.startsWith('preset:')
  const isPreset = avatarUrl?.startsWith('preset:')

  return (
    <div className="max-w-lg">
      <h1 className="text-3xl font-black text-white mb-6">Profile</h1>

      <form onSubmit={handleSave} className="bg-[#141414] rounded-xl border border-[#2e2e2e] p-6 space-y-6">

        {/* Avatar preview + info */}
        <div className="flex items-center gap-4 pb-4 border-b border-[#2e2e2e]">
          <div className="relative group">
            <div className="w-16 h-16 rounded-full overflow-hidden">
              {isPhoto ? (
                <img src={avatarUrl!} alt={name} className="w-full h-full object-cover" />
              ) : (
                <div
                  className="w-full h-full rounded-full flex items-center justify-center"
                  style={{ backgroundColor: avatarColor }}
                >
                  {isPreset ? (() => {
                    const iconName = avatarUrl!.split(':')[1]
                    const entry = PRESET_ICONS.find(p => p.name === iconName)
                    return entry ? <entry.Icon className="w-7 h-7 text-white" strokeWidth={2} /> : null
                  })() : (
                    <span className="text-white font-bold text-xl">
                      {name ? name.slice(0, 2).toUpperCase() : 'YO'}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div>
            <p className="font-bold text-white text-lg">{name || 'Your name'}</p>
            <p className="text-base text-[#888]">{user.email}</p>
            <span className="text-sm bg-[#1e1e1e] text-[#888] px-2 py-0.5 rounded-full mt-1 inline-block capitalize">
              {user.role}
            </span>
          </div>
        </div>

        {/* Photo upload */}
        <div>
          <p className="text-base font-medium text-[#ccc] mb-3">Profile Picture</p>
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] text-[#ccc] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {uploading ? 'Uploading...' : 'Upload Photo'}
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={() => setAvatarUrl(null)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#666] hover:text-[#aaa] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Use Initials
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoUpload}
            className="hidden"
          />
          {uploadError && (
            <p className="text-xs text-[#ff3c00] mb-3">{uploadError}</p>
          )}

          {/* Preset icons */}
          <p className="text-sm text-[#666] mb-2">Or choose an icon</p>
          <div className="grid grid-cols-5 gap-2">
            {PRESET_ICONS.map(({ name: iconName, Icon }) => {
              const isSelected = avatarUrl === `preset:${iconName}`
              return (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setAvatarUrl(`preset:${iconName}`)}
                  className={cn(
                    'aspect-square rounded-xl flex items-center justify-center transition-all',
                    isSelected
                      ? 'ring-2 ring-[#ff3c00] ring-offset-2 ring-offset-[#141414] scale-105'
                      : 'hover:scale-105 hover:ring-1 hover:ring-[#444] ring-offset-[#141414]'
                  )}
                  style={{ backgroundColor: avatarColor }}
                  title={iconName}
                >
                  <Icon className="w-5 h-5 text-white" strokeWidth={2} />
                </button>
              )
            })}
          </div>
        </div>

        {/* Avatar color */}
        <div>
          <label className="block text-base font-medium text-[#ccc] mb-2">
            {isPhoto ? 'Accent Color' : 'Background Color'}
          </label>
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

        {/* Username */}
        <div>
          <label className="block text-base font-medium text-[#ccc] mb-1.5">Username</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, ''))}
            required
            placeholder="e.g. johndoe"
            className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]"
          />
          <p className="text-xs text-[#555] mt-1">Lowercase letters and numbers only. Used for @mentions.</p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 px-4 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white font-semibold rounded-lg text-base transition-colors"
        >
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}

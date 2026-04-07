'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PRESET_ICONS } from '@/components/ui/Avatar'
import { Upload, X, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/contexts/UserContext'

const AVATAR_COLORS = [
  '#fbbf24', '#fb923c', '#f7931a', '#60a5fa',
  '#a78bfa', '#f472b6', '#34d399', '#38bdf8',
  '#ef4444', '#10b981', '#6366f1', '#ec4899',
]

function getPasswordStrength(pw: string): 'weak' | 'medium' | 'strong' | null {
  if (!pw) return null
  if (pw.length < 8) return 'weak'
  let score = 0
  if (/[a-z]/.test(pw)) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++
  return score <= 2 ? 'medium' : 'strong'
}

const STRENGTH_COLOR = { weak: '#ef4444', medium: '#f59e0b', strong: '#22c55e' }
const STRENGTH_WIDTH = { weak: '33%', medium: '66%', strong: '100%' }
const STRENGTH_LABEL = { weak: 'Weak', medium: 'Medium', strong: 'Strong' }

export default function ProfilePage() {
  const { user: contextUser, setUser: setContextUser } = useCurrentUser()
  const supabase = createClient()

  const [name, setName] = useState(contextUser.name)
  const [avatarColor, setAvatarColor] = useState(contextUser.avatar_color)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(contextUser.avatar_url)

  // Pending photo (selected but not yet uploaded)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)

  // Form state
  const [saving, setSaving] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [nameError, setNameError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync if context user changes (e.g. from realtime)
  useEffect(() => {
    setName(contextUser.name)
    setAvatarColor(contextUser.avatar_color)
    setAvatarUrl(contextUser.avatar_url)
  }, [contextUser.id])

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview) }
  }, [])

  function showToast(msg: string, error = false) {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3500)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image must be under 5MB.')
      return
    }
    setUploadError('')
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(file)
    setPendingPreview(URL.createObjectURL(file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function clearPhoto() {
    if (pendingPreview) { URL.revokeObjectURL(pendingPreview); setPendingPreview(null) }
    setPendingFile(null)
    setAvatarUrl(null)
  }

  function selectIcon(iconName: string) {
    if (pendingPreview) { URL.revokeObjectURL(pendingPreview); setPendingPreview(null) }
    setPendingFile(null)
    setAvatarUrl(`preset:${iconName}`)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setNameError('')
    setPasswordError('')
    setUploadError('')
    setSaving(true)

    // Validate and clean username
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!cleanName) {
      setNameError('Username cannot be empty.')
      setSaving(false)
      return
    }

    // Uniqueness check
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('name', cleanName)
      .neq('id', contextUser.id)
      .maybeSingle()
    if (existing) {
      setNameError('This username is already taken. Please choose another.')
      setSaving(false)
      return
    }

    // Password change
    if (newPassword || confirmPassword) {
      if (!newPassword || !confirmPassword) {
        setPasswordError('Please fill in both password fields.')
        setSaving(false)
        return
      }
      if (newPassword !== confirmPassword) {
        setPasswordError('Passwords do not match.')
        setSaving(false)
        return
      }
      if (newPassword.length < 8) {
        setPasswordError('Password must be at least 8 characters.')
        setSaving(false)
        return
      }
      const { error: pwError } = await supabase.auth.updateUser({ password: newPassword })
      if (pwError) {
        setPasswordError('Failed to update password. Please try again.')
        setSaving(false)
        return
      }
    }

    // Upload photo if pending
    let finalAvatarUrl = avatarUrl
    if (pendingFile) {
      const ext = (pendingFile.name.split('.').pop() ?? 'jpg').toLowerCase()
      const path = `${contextUser.id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, pendingFile, { upsert: true, contentType: pendingFile.type })
      if (uploadErr) {
        setUploadError('Failed to upload photo. Please try again.')
        setSaving(false)
        return
      }
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      finalAvatarUrl = `${publicUrl}?t=${Date.now()}`
      if (pendingPreview) { URL.revokeObjectURL(pendingPreview); setPendingPreview(null) }
      setPendingFile(null)
    }

    // Save to users table
    const { error: saveErr } = await supabase.from('users').update({
      name: cleanName,
      avatar_color: avatarColor,
      avatar_url: finalAvatarUrl,
    }).eq('id', contextUser.id)

    if (saveErr) {
      showToast('Failed to save profile. Please try again.', true)
      setSaving(false)
      return
    }

    // Update context (sidebar + topbar update immediately)
    const updatedUser = { ...contextUser, name: cleanName, avatar_color: avatarColor, avatar_url: finalAvatarUrl }
    setContextUser(updatedUser)
    setName(cleanName)
    setAvatarUrl(finalAvatarUrl)
    if (newPassword) { setNewPassword(''); setConfirmPassword('') }
    showToast('Profile saved successfully!')
    setSaving(false)
  }

  // ── Avatar rendering helper ───────────────────────────────────────────────
  function renderAvatar(size: 'sm' | 'md' | 'lg') {
    const sizes = { sm: 'w-6 h-6', md: 'w-8 h-8', lg: 'w-16 h-16' }
    const iconSizes = { sm: 'w-3 h-3', md: 'w-4 h-4', lg: 'w-7 h-7' }
    const textSizes = { sm: 'text-[10px]', md: 'text-sm', lg: 'text-xl' }

    // Photo: pending preview takes priority over saved URL
    const photoUrl = pendingPreview ?? (avatarUrl && !avatarUrl.startsWith('preset:') ? avatarUrl : null)
    if (photoUrl) {
      return (
        <img
          src={photoUrl}
          alt="avatar"
          className={`${sizes[size]} rounded-full object-cover shrink-0 bg-[#333]`}
        />
      )
    }

    // Icon or initials
    const iconEntry = avatarUrl?.startsWith('preset:')
      ? PRESET_ICONS.find(p => p.name === avatarUrl.split(':')[1])
      : null

    return (
      <div
        className={`${sizes[size]} rounded-full flex items-center justify-center font-semibold text-white shrink-0`}
        style={{ backgroundColor: avatarColor }}
      >
        {iconEntry
          ? <iconEntry.Icon className={iconSizes[size]} strokeWidth={2} />
          : <span className={textSizes[size]}>{name ? name[0].toUpperCase() : 'U'}</span>
        }
      </div>
    )
  }

  const pwStrength = getPasswordStrength(newPassword)
  const roleLabel = contextUser.role === 'admin' ? 'Admin' : contextUser.role === 'ops_manager' ? 'Manager' : 'Member'

  return (
    <div className="max-w-lg">
      <h1 className="text-3xl font-black text-white mb-6">Profile</h1>

      {/* Toast */}
      {toast && (
        <div className={cn(
          'mb-4 px-4 py-3 rounded-xl text-sm font-medium',
          toast.error
            ? 'bg-red-500/10 border border-red-500/30 text-red-400'
            : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
        )}>
          {toast.msg}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-[#141414] rounded-xl border border-[#2e2e2e] p-6 space-y-6">

        {/* Header: avatar + name + email */}
        <div className="flex items-center gap-4 pb-4 border-b border-[#2e2e2e]">
          {renderAvatar('lg')}
          <div>
            <p className="font-bold text-white text-lg">{name || 'Your name'}</p>
            <p className="text-base text-[#888]">{contextUser.email}</p>
            <span className="text-sm bg-[#1e1e1e] text-[#888] px-2 py-0.5 rounded-full mt-1 inline-block">
              {roleLabel}
            </span>
          </div>
        </div>

        {/* ── Profile Picture ──────────────────────────────────── */}
        <div>
          <p className="text-base font-medium text-[#ccc] mb-3">Profile Picture</p>

          {/* Upload + clear buttons */}
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] text-[#ccc] rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Upload Photo
            </button>
            <button
              type="button"
              onClick={clearPhoto}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#666] hover:text-[#aaa] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Use Initials
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            className="hidden"
          />

          {uploadError && <p className="text-xs text-[#ff3c00] mb-3">{uploadError}</p>}

          {/* Circular crop preview of pending photo */}
          {pendingPreview && (
            <div className="mb-4 flex items-center gap-3 px-3 py-3 rounded-xl" style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-14 h-14 rounded-full overflow-hidden shrink-0" style={{ border: '2px solid rgba(255,255,255,0.15)' }}>
                <img src={pendingPreview} alt="preview" className="w-full h-full object-cover" />
              </div>
              <div>
                <p className="text-sm text-white font-medium">Photo preview</p>
                <p className="text-xs text-[#555] mt-0.5">Will be saved when you click Save Changes</p>
              </div>
            </div>
          )}

          {/* Preset icons grid */}
          <p className="text-sm text-[#666] mb-2">Or choose an icon</p>
          <div className="grid grid-cols-5 gap-2">
            {PRESET_ICONS.map(({ name: iconName, Icon }) => {
              const isSelected = !pendingPreview && avatarUrl === `preset:${iconName}`
              return (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => selectIcon(iconName)}
                  className={cn(
                    'aspect-square rounded-xl flex items-center justify-center transition-all cursor-pointer',
                    isSelected
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-[#141414] scale-105'
                      : 'hover:scale-105 hover:ring-1 hover:ring-[#555] ring-offset-[#141414]'
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

        {/* ── Background Color ─────────────────────────────────── */}
        <div>
          <label className="block text-base font-medium text-[#ccc] mb-2">Background Color</label>
          <div className="flex flex-wrap gap-2">
            {AVATAR_COLORS.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => setAvatarColor(color)}
                className="w-8 h-8 rounded-full transition-transform hover:scale-110 cursor-pointer"
                style={{
                  backgroundColor: color,
                  outline: avatarColor === color ? '2px solid white' : 'none',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
        </div>

        {/* ── Live Preview ─────────────────────────────────────── */}
        <div>
          <p className="text-base font-medium text-[#ccc] mb-3">Preview</p>
          <div className="space-y-2 rounded-xl p-4" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)' }}>
            {/* Sidebar preview */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: '#161616' }}>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[#444] w-14 shrink-0">Sidebar</span>
              {renderAvatar('lg')}
              <div>
                <p className="text-sm font-semibold text-white">{name || 'username'}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{roleLabel}</p>
              </div>
            </div>
            {/* Task row preview */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: '#161616' }}>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[#444] w-14 shrink-0">Task</span>
              {renderAvatar('sm')}
              <span className="text-sm text-white">{name || 'username'}</span>
            </div>
          </div>
        </div>

        {/* ── Username ─────────────────────────────────────────── */}
        <div>
          <label className="block text-base font-medium text-[#ccc] mb-1.5">Username</label>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setNameError('') }}
            required
            placeholder="e.g. johndoe"
            className="w-full px-3 py-2 bg-[#1e1e1e] border text-white rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]"
            style={{ borderColor: nameError ? '#ff3c00' : 'rgba(255,255,255,0.1)' }}
          />
          {nameError
            ? <p className="text-xs text-[#ff3c00] mt-1">{nameError}</p>
            : <p className="text-xs text-[#555] mt-1">Lowercase letters, numbers, and underscores only. Used for @mentions.</p>
          }
        </div>

        {/* ── Change Password ──────────────────────────────────── */}
        <div>
          <p className="text-base font-medium text-[#ccc] mb-3">Change Password</p>
          <div className="space-y-3">
            {/* New password */}
            <div>
              <label className="text-xs text-[#888] mb-1 block">New password</label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => { setNewPassword(e.target.value); setPasswordError('') }}
                  placeholder="Leave blank to keep current"
                  className="w-full px-3 py-2 pr-10 bg-[#1e1e1e] border text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]"
                  style={{ borderColor: passwordError ? '#ff3c00' : 'rgba(255,255,255,0.1)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#aaa] transition-colors cursor-pointer"
                >
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Strength bar */}
              {newPassword && pwStrength && (
                <div className="mt-1.5">
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: '#2a2a2a' }}>
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: STRENGTH_WIDTH[pwStrength],
                        background: STRENGTH_COLOR[pwStrength],
                      }}
                    />
                  </div>
                  <p className="text-[11px] mt-0.5" style={{ color: STRENGTH_COLOR[pwStrength] }}>
                    {STRENGTH_LABEL[pwStrength]}
                  </p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="text-xs text-[#888] mb-1 block">Confirm new password</label>
              <div className="relative">
                <input
                  type={showConfirmPw ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setPasswordError('') }}
                  placeholder="Repeat new password"
                  className="w-full px-3 py-2 pr-10 bg-[#1e1e1e] border text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]"
                  style={{ borderColor: passwordError ? '#ff3c00' : 'rgba(255,255,255,0.1)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPw(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#aaa] transition-colors cursor-pointer"
                >
                  {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {passwordError && <p className="text-xs text-[#ff3c00]">{passwordError}</p>}
          </div>
        </div>

        {/* ── Save ─────────────────────────────────────────────── */}
        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 px-4 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white font-semibold rounded-lg text-base transition-colors cursor-pointer"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}

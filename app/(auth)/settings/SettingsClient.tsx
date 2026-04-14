'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Client, DbTaskTemplate, ActivityEntry, UserRole, Track, PipelineTrigger, canManageTeam } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { InfoIcon } from '@/components/ui/InfoIcon'
import { cn, formatDate } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { Users, Building2, Activity, Plus, Trash2, RefreshCw, ChevronDown, Check, X, Zap, Pencil, Copy, MoreHorizontal, GripVertical, UserMinus, UserCheck, AlertTriangle, Link2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Tab = 'team' | 'clients' | 'activity' | 'integrations'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  ops_manager: 'Ops Manager',
  member: 'Basic',
}

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Full access + user management',
  ops_manager: 'Full access except user management',
  member: 'Own tasks only',
}

const TRACKS: Track[] = ['Long-form', 'Trailer', 'Thumbnails', 'Clips & Shorts', 'Review', 'Publishing']

const AVATAR_COLORS = ['#ff3c00', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

type PresenceStatus = 'online' | 'idle'

interface ActionTarget {
  user: User
  action: 'deactivate' | 'delete'
  tasks: { id: string; label: string }[]
}

interface Props {
  currentUser: User
  allUsers: User[]
  taskCountByUser: Record<string, number>
  clients: Client[]
  templates: DbTaskTemplate[]
  activity: ActivityEntry[]
  triggers: PipelineTrigger[]
}

export function SettingsClient({ currentUser, allUsers, taskCountByUser, clients, templates, activity, triggers }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('team')

  const tabs = [
    { id: 'team' as Tab, label: 'Team', icon: Users },
    { id: 'clients' as Tab, label: 'Clients & Templates', icon: Building2 },
    { id: 'activity' as Tab, label: 'Activity', icon: Activity },
    ...(currentUser.role === 'admin' ? [{ id: 'integrations' as Tab, label: 'Integrations', icon: Zap }] : []),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-white">Settings</h1>
        <p className="text-[#888] text-[15px] mt-1">Manage your team, clients, and production history</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold tracking-[0.06em] transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-[#ff3c00] text-white'
                : 'border-transparent text-[#666] hover:text-[#ccc]'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'team' && (
        <TeamTab
          currentUser={currentUser}
          allUsers={allUsers}
          taskCountByUser={taskCountByUser}
        />
      )}
      {activeTab === 'clients' && (
        <ClientsTab
          currentUser={currentUser}
          clients={clients}
          templates={templates}
          allUsers={allUsers}
          triggers={triggers}
        />
      )}
      {activeTab === 'activity' && <ActivityTab activity={activity} />}
      {activeTab === 'integrations' && <IntegrationsTab />}
    </div>
  )
}

// ─── Team Tab ─────────────────────────────────────────────────────────────────

function TeamTab({ currentUser, allUsers, taskCountByUser }: {
  currentUser: User
  allUsers: User[]
  taskCountByUser: Record<string, number>
}) {
  const supabase = createClient()
  const isAdmin = canManageTeam(currentUser)
  const [users, setUsers] = useState<User[]>(allUsers)
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>(taskCountByUser)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteConfirm, setInviteConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [inviteRole, setInviteRole] = useState<UserRole>('member')
  const [inviteColor, setInviteColor] = useState(AVATAR_COLORS[1])
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState<{ name: string; email: string; password: string } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [toastError, setToastError] = useState(false)
  const [onlineStatus, setOnlineStatus] = useState<Record<string, PresenceStatus>>({})
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null)
  const [reassigneeId, setReassigneeId] = useState('')
  const [updateTemplates, setUpdateTemplates] = useState(true)
  const [modalLoading, setModalLoading] = useState(false)

  function showToast(msg: string, isError = false) {
    setToast(msg)
    setToastError(isError)
    setTimeout(() => setToast(''), 3000)
  }

  // ── Presence subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel('online-users')
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ userId: string; isIdle?: boolean }>()
      const next: Record<string, PresenceStatus> = {}
      for (const presences of Object.values(state)) {
        const p = (presences as { userId: string; isIdle?: boolean }[])[0]
        if (p?.userId) next[p.userId] = p.isIdle ? 'idle' : 'online'
      }
      setOnlineStatus(next)
    })
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  function resetInviteForm() {
    setInviteEmail(''); setInviteName(''); setInviteUsername('')
    setInvitePassword(''); setInviteConfirm('')
    setInviteRole('member'); setInviteColor(AVATAR_COLORS[1])
    setInviteError(''); setInviteSuccess(null)
    setShowPassword(false); setShowConfirm(false)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError('')
    if (invitePassword !== inviteConfirm) { setInviteError('Passwords do not match.'); return }
    if (invitePassword.length < 8) { setInviteError('Password must be at least 8 characters.'); return }
    setInviteLoading(true)
    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, name: inviteName, username: inviteUsername, role: inviteRole, avatarColor: inviteColor, password: invitePassword }),
    })
    const data = await res.json()
    if (!res.ok) { setInviteError(data.error); setInviteLoading(false); return }
    setInviteSuccess({ name: inviteName, email: inviteEmail, password: invitePassword })
    const { data: updatedUsers } = await supabase.from('users').select('*').order('name')
    if (updatedUsers) setUsers(updatedUsers as User[])
    setInviteLoading(false)
  }

  async function handleRoleChange(userId: string, newRole: UserRole) {
    const prevUsers = users
    const userName = users.find(u => u.id === userId)?.name ?? 'user'
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
    setActionLoading(userId + '-role')
    const { error } = await supabase.from('users').update({ role: newRole }).eq('id', userId)
    setActionLoading(null)
    if (error) {
      setUsers(prevUsers)
      showToast('Failed to update role. Please try again.', true)
    } else {
      showToast(`Role updated for ${userName}`)
    }
  }

  async function handleResetPassword(userId: string) {
    setActionLoading(userId + '-reset')
    await fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' })
    setActionLoading(null)
    showToast('Password reset email sent')
  }

  async function openActionModal(user: User, action: 'deactivate' | 'delete') {
    setReassigneeId('')
    setUpdateTemplates(true)
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, label')
      .eq('assignee_id', user.id)
      .in('status', ['ready', 'in_progress', 'in_review', 'revision'])
    setActionTarget({ user, action, tasks: tasks ?? [] })
  }

  async function handleConfirmAction() {
    if (!actionTarget) return
    const { user, action, tasks } = actionTarget
    setModalLoading(true)

    // Reassign active tasks
    if (tasks.length > 0 && reassigneeId) {
      await supabase.from('tasks').update({ assignee_id: reassigneeId }).in('id', tasks.map(t => t.id))
      setTaskCounts(prev => ({
        ...prev,
        [user.id]: 0,
        [reassigneeId]: (prev[reassigneeId] || 0) + tasks.length,
      }))
    }

    // Also update task templates so future episodes assign to the new person
    if (reassigneeId && updateTemplates) {
      await supabase.from('task_templates').update({ assignee_id: reassigneeId }).eq('assignee_id', user.id)
    }

    if (action === 'deactivate') {
      const { error } = await supabase.from('users').update({ active: false }).eq('id', user.id)
      if (error) {
        showToast('Failed to deactivate user. Please try again.', true)
      } else {
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: false } : u))
        showToast(`${user.name} has been deactivated`)
      }
    } else {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      if (!res.ok) {
        showToast('Failed to delete user. Please try again.', true)
      } else {
        setUsers(prev => prev.filter(u => u.id !== user.id))
        showToast(`${user.name} has been removed`)
      }
    }

    setModalLoading(false)
    setActionTarget(null)
  }

  async function handleReactivate(userId: string) {
    setActionLoading(userId + '-reactivate')
    const { error } = await supabase.from('users').update({ active: true }).eq('id', userId)
    setActionLoading(null)
    if (error) {
      showToast('Failed to reactivate user.', true)
    } else {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, active: true } : u))
      const userName = users.find(u => u.id === userId)?.name ?? 'user'
      showToast(`${userName} has been reactivated`)
    }
  }

  const activeUsers = users.filter(u => u.active !== false)
  const inactiveUsers = users.filter(u => u.active === false)
  const otherActiveUsers = activeUsers.filter(u => u.id !== currentUser.id)

  return (
    <div className="space-y-4">
      {toast && (
        <div className="bg-[#141414] border border-[#2e2e2e] rounded-lg px-4 py-2.5 text-sm text-white flex items-center gap-2">
          {toastError ? <X className="w-4 h-4 text-red-400" /> : <Check className="w-4 h-4 text-green-400" />}
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[#888]">{activeUsers.length} members</p>
        {isAdmin && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="flex items-center gap-2 px-4 py-2 bg-[#ff3c00] hover:bg-[#e63600] text-white rounded-lg text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />Invite member
          </button>
        )}
      </div>

      {showInvite && isAdmin && (
        <div className="bg-[#141414] border border-[#2e2e2e] rounded-xl p-5 space-y-4">
          <h3 className="font-bold text-white">Create new account</h3>

          {inviteSuccess ? (
            <div className="space-y-4">
              <div className="bg-[#0d2b1a] border border-[#1a5c33] rounded-lg px-4 py-3">
                <p className="text-sm text-[#4ade80] font-medium">Account created for {inviteSuccess.name}. Share these credentials privately:</p>
              </div>
              <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg p-4 font-mono text-sm space-y-1">
                <p className="text-[#888]">Email: <span className="text-white">{inviteSuccess.email}</span></p>
                <p className="text-[#888]">Temporary password: <span className="text-white">{inviteSuccess.password}</span></p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(`Email: ${inviteSuccess.email}\nTemporary password: ${inviteSuccess.password}`).then(() => showToast('Credentials copied'))}
                  className="flex-1 px-4 py-2 bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] text-[#ccc] rounded-lg text-sm font-medium transition-colors"
                >
                  Copy credentials
                </button>
                <button
                  type="button"
                  onClick={() => { resetInviteForm(); setShowInvite(false) }}
                  className="flex-1 px-4 py-2 bg-[#ff3c00] hover:bg-[#e63600] text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-4">
              {inviteError && <p className="text-sm text-[#ff3c00]">{inviteError}</p>}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#888] mb-1 block">Full name</label>
                  <input value={inviteName} onChange={e => setInviteName(e.target.value)} required placeholder="Jane Smith"
                    className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]" />
                </div>
                <div>
                  <label className="text-xs text-[#888] mb-1 block">Username</label>
                  <input
                    value={inviteUsername}
                    onChange={e => setInviteUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    required placeholder="e.g. eph (lowercase, no spaces)"
                    className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]" />
                </div>
              </div>

              <div>
                <label className="text-xs text-[#888] mb-1 block">Email</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required placeholder="jane@studio.com"
                  className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#888] mb-1 block">Temporary password</label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} value={invitePassword} onChange={e => setInvitePassword(e.target.value)} required minLength={8} placeholder="Min 8 characters"
                      className="w-full px-3 py-2 pr-10 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]" />
                    <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888] text-xs">
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[#888] mb-1 block">Confirm password</label>
                  <div className="relative">
                    <input type={showConfirm ? 'text' : 'password'} value={inviteConfirm} onChange={e => setInviteConfirm(e.target.value)} required minLength={8} placeholder="••••••••"
                      className="w-full px-3 py-2 pr-10 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]" />
                    <button type="button" onClick={() => setShowConfirm(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888] text-xs">
                      {showConfirm ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#555]">Share this password privately with the team member. They will be prompted to change it on first login.</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#888] mb-1 block">Role</label>
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00]">
                    <option value="admin">Admin — Full access + user management</option>
                    <option value="ops_manager">Ops Manager — Full access, no user management</option>
                    <option value="member">Basic — Own tasks only</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#888] mb-1 block">Avatar colour</label>
                  <div className="flex gap-2 flex-wrap pt-1">
                    {AVATAR_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setInviteColor(c)}
                        className={cn('w-7 h-7 rounded-full border-2 transition-all', inviteColor === c ? 'border-white scale-110' : 'border-transparent')}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { resetInviteForm(); setShowInvite(false) }}
                  className="px-4 py-2 text-sm text-[#888] hover:text-white transition-colors">Cancel</button>
                <button type="submit" disabled={inviteLoading}
                  className="px-4 py-2 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors">
                  {inviteLoading ? 'Creating...' : 'Create account'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Users table */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="grid grid-cols-[1fr_140px_80px_120px] px-4 py-3 border-b" style={{ background: '#1a1a1a', borderColor: 'rgba(255,255,255,0.08)' }}>
          <span className="text-[12px] font-semibold text-[#666] uppercase tracking-[0.08em]">Member</span>
          <span className="text-[12px] font-semibold text-[#666] uppercase tracking-[0.08em]">Role</span>
          <span className="text-[12px] font-semibold text-[#666] uppercase tracking-[0.08em]">Tasks</span>
          <span className="text-[12px] font-semibold text-[#666] uppercase tracking-[0.08em]">Actions</span>
        </div>

        {activeUsers.map(u => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === currentUser.id}
            isAdmin={isAdmin}
            activeTasks={taskCounts[u.id] || 0}
            actionLoading={actionLoading}
            presenceStatus={onlineStatus[u.id]}
            onRoleChange={handleRoleChange}
            onResetPassword={handleResetPassword}
            onDeactivate={() => openActionModal(u, 'deactivate')}
            onDelete={() => openActionModal(u, 'delete')}
          />
        ))}

        {inactiveUsers.length > 0 && (
          <>
            <div className="px-4 py-2" style={{ background: '#111', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <span className="text-[11px] font-semibold text-[#444] uppercase tracking-widest">
                Deactivated ({inactiveUsers.length})
              </span>
            </div>
            {inactiveUsers.map(u => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={false}
                isAdmin={isAdmin}
                activeTasks={0}
                actionLoading={actionLoading}
                presenceStatus={undefined}
                inactive
                onRoleChange={handleRoleChange}
                onResetPassword={handleResetPassword}
                onDeactivate={() => {}}
                onDelete={() => openActionModal(u, 'delete')}
                onReactivate={() => handleReactivate(u.id)}
              />
            ))}
          </>
        )}
      </div>

      {/* Action confirmation modal */}
      {actionTarget && (
        <UserActionModal
          target={actionTarget}
          otherUsers={otherActiveUsers}
          reassigneeId={reassigneeId}
          onReassigneeChange={setReassigneeId}
          updateTemplates={updateTemplates}
          onUpdateTemplatesChange={setUpdateTemplates}
          loading={modalLoading}
          onConfirm={handleConfirmAction}
          onCancel={() => setActionTarget(null)}
        />
      )}
    </div>
  )
}

function UserRow({ user, isSelf, isAdmin, activeTasks, actionLoading, presenceStatus, inactive, onRoleChange, onResetPassword, onDeactivate, onDelete, onReactivate }: {
  user: User; isSelf: boolean; isAdmin: boolean; activeTasks: number
  actionLoading: string | null
  presenceStatus: PresenceStatus | undefined
  inactive?: boolean
  onRoleChange: (id: string, role: UserRole) => void
  onResetPassword: (id: string) => void
  onDeactivate: () => void
  onDelete: () => void
  onReactivate?: () => void
}) {
  const [showRoleMenu, setShowRoleMenu] = useState(false)

  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_140px_80px_120px] px-4 border-b last:border-0 items-center hover:bg-white/[0.02] transition-colors group',
        inactive && 'opacity-50'
      )}
      style={{ minHeight: '56px', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      {/* Name + email + presence */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Avatar with presence dot */}
        <div className="relative inline-flex shrink-0">
          <Avatar name={user.name} color={user.avatar_color} size="sm" avatarUrl={user.avatar_url} />
          {presenceStatus && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-[#161616]"
              style={{ background: presenceStatus === 'online' ? '#22c55e' : '#f59e0b' }}
              title={presenceStatus === 'online' ? 'Online' : 'Idle'}
            >
              {presenceStatus === 'online' && (
                <span className="absolute inset-0 rounded-full animate-ping" style={{ background: '#22c55e', opacity: 0.6 }} />
              )}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[14px] font-medium text-white truncate">
            {user.name}
            {isSelf && <span className="text-[#555] text-[12px] ml-1">(you)</span>}
            {inactive && <span className="text-[#555] text-[11px] ml-1.5">Deactivated</span>}
          </p>
          <p className="text-[13px] text-[#666] truncate">{user.email}</p>
        </div>
      </div>

      {/* Role */}
      <div className="relative">
        {isAdmin && !isSelf && !inactive ? (
          <>
            <button
              onClick={() => setShowRoleMenu(!showRoleMenu)}
              className="flex items-center gap-1.5 text-xs font-medium text-[#ccc] hover:text-white transition-colors"
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', user.role === 'admin' ? 'bg-[#ff3c00]' : user.role === 'ops_manager' ? 'bg-yellow-400' : 'bg-[#555]')} />
              {ROLE_LABELS[user.role]}
              <ChevronDown className="w-3 h-3 text-[#555]" />
            </button>
            {showRoleMenu && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-[#141414] border border-[#2e2e2e] rounded-lg shadow-xl z-10 overflow-hidden">
                {(['admin', 'ops_manager', 'member'] as UserRole[]).map(role => (
                  <button
                    key={role}
                    onClick={() => { onRoleChange(user.id, role); setShowRoleMenu(false) }}
                    className="w-full text-left px-4 py-2.5 hover:bg-[#1e1e1e] transition-colors"
                  >
                    <p className="text-sm text-white font-medium">{ROLE_LABELS[role]}</p>
                    <p className="text-xs text-[#666]">{ROLE_DESCRIPTIONS[role]}</p>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-[#666]">
            <span className={cn('w-1.5 h-1.5 rounded-full', user.role === 'admin' ? 'bg-[#ff3c00]' : user.role === 'ops_manager' ? 'bg-yellow-400' : 'bg-[#555]')} />
            {ROLE_LABELS[user.role]}
          </span>
        )}
      </div>

      {/* Active tasks */}
      <div>
        <span className={cn('text-sm font-semibold', activeTasks > 0 ? 'text-white' : 'text-[#444]')}>
          {activeTasks > 0 ? activeTasks : '—'}
        </span>
        {activeTasks > 0 && <span className="text-xs text-[#666] ml-1">active</span>}
      </div>

      {/* Actions */}
      {isAdmin && !isSelf && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!inactive && (
            <button onClick={() => onResetPassword(user.id)} disabled={actionLoading === user.id + '-reset'}
              title="Send password reset"
              className="p-1.5 rounded hover:bg-[#1e1e1e] text-[#555] hover:text-white transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {!inactive ? (
            <button onClick={onDeactivate} title="Deactivate user"
              className="p-1.5 rounded hover:bg-amber-500/10 text-[#555] hover:text-amber-400 transition-colors">
              <UserMinus className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button onClick={onReactivate} disabled={actionLoading === user.id + '-reactivate'}
              title="Reactivate user"
              className="p-1.5 rounded hover:bg-emerald-500/10 text-[#555] hover:text-emerald-400 transition-colors">
              <UserCheck className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onDelete} title="Delete user permanently"
            className="p-1.5 rounded hover:bg-[#ff3c00]/20 text-[#555] hover:text-[#ff3c00] transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function UserActionModal({ target, otherUsers, reassigneeId, onReassigneeChange, updateTemplates, onUpdateTemplatesChange, loading, onConfirm, onCancel }: {
  target: ActionTarget
  otherUsers: User[]
  reassigneeId: string
  onReassigneeChange: (id: string) => void
  updateTemplates: boolean
  onUpdateTemplatesChange: (v: boolean) => void
  loading: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { user, action, tasks } = target
  const hasTasks = tasks.length > 0
  const isDelete = action === 'delete'

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        className="w-full max-w-[440px] mx-4 rounded-2xl"
        style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-[16px] font-bold text-white">
            {isDelete ? 'Delete' : 'Deactivate'} {user.name}
          </h2>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-white/5 text-[#555] hover:text-white transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {isDelete && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(255,60,0,0.08)', border: '1px solid rgba(255,60,0,0.2)' }}>
              <AlertTriangle className="w-4 h-4 text-[#ff3c00] shrink-0 mt-0.5" />
              <p className="text-sm text-[#ff3c00]">This permanently deletes the user and cannot be undone.</p>
            </div>
          )}

          {hasTasks ? (
            <div className="space-y-3">
              <p className="text-sm text-[#aaa]">
                {user.name} has <span className="text-white font-semibold">{tasks.length} active task{tasks.length !== 1 ? 's' : ''}</span>.
                Reassign them before {isDelete ? 'deleting' : 'deactivating'}.
              </p>
              <div>
                <label className="text-[12px] text-[#888] mb-1.5 block font-medium">Reassign all tasks to</label>
                <select
                  value={reassigneeId}
                  onChange={e => onReassigneeChange(e.target.value)}
                  className="w-full px-3 py-2 text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#f7931a]"
                  style={{ background: '#222', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <option value="">Select team member…</option>
                  {otherUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              {/* Template update checkbox — only relevant when a reassignee is chosen */}
              {reassigneeId && (
                <label className="flex items-start gap-2.5 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={updateTemplates}
                    onChange={e => onUpdateTemplatesChange(e.target.checked)}
                    className="mt-0.5 accent-[#f7931a] w-3.5 h-3.5 shrink-0 cursor-pointer"
                  />
                  <span className="text-[13px] text-[#aaa] group-hover:text-white transition-colors leading-snug">
                    Also update task templates
                    <span className="block text-[11px] text-[#555] mt-0.5">
                      Future episodes for all clients will assign these task slots to {otherUsers.find(u => u.id === reassigneeId)?.name ?? 'the new member'} instead
                    </span>
                  </span>
                </label>
              )}

              {/* Task list preview */}
              <div className="max-h-[120px] overflow-y-auto space-y-1">
                {tasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: '#1a1a1a' }}>
                    <span className="w-1 h-1 rounded-full bg-[#555] shrink-0" />
                    <span className="text-[12px] text-[#888] truncate">{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#aaa]">
              {isDelete
                ? `${user.name} has no active tasks and will be permanently removed from the system.`
                : `${user.name} has no active tasks. They will be prevented from logging in.`}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium text-[#aaa] hover:text-white transition-colors cursor-pointer"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || (hasTasks && !reassigneeId)}
            className={cn(
              'flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-40 cursor-pointer',
              isDelete ? 'bg-[#ff3c00] hover:bg-[#e63600]' : 'bg-[#2a2a2a] hover:bg-[#333]',
            )}
            style={{ border: isDelete ? '1px solid #ff3c00' : '1px solid rgba(255,255,255,0.15)' }}
          >
            {loading ? 'Processing…' : isDelete ? 'Delete permanently' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Clients Tab ──────────────────────────────────────────────────────────────

function ClientsTab({ currentUser, clients: initialClients, templates: initialTemplates, allUsers, triggers: initialTriggers }: {
  currentUser: User; clients: Client[]; templates: DbTaskTemplate[]; allUsers: User[]; triggers: PipelineTrigger[]
}) {
  const supabase = createClient()
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [templates, setTemplates] = useState<DbTaskTemplate[]>(initialTemplates)
  const [triggers, setTriggers] = useState<PipelineTrigger[]>(initialTriggers)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(initialClients[0]?.id || null)
  const [addingClient, setAddingClient] = useState(false)
  const [newClientLabel, setNewClientLabel] = useState('')
  const [duplicateModal, setDuplicateModal] = useState<{ clientId: string; name: string; key: string } | null>(null)
  const [channelId, setChannelId] = useState(initialClients[0]?.slack_channel_id || '')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)
  const [renamingClient, setRenamingClient] = useState(false)
  const [clientNameInput, setClientNameInput] = useState('')
  const [clientMenuOpen, setClientMenuOpen] = useState<string | null>(null)

  // Multi-template support
  const initialClientTpls = initialTemplates.filter(t => t.client_id === initialClients[0]?.id)
  const initialTemplateNames = [...new Set(initialClientTpls.map(t => t.template_name || 'Default'))]
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>(initialTemplateNames[0] || 'Default')
  const [addingTemplate, setAddingTemplate] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  const selectedClient = clients.find(c => c.id === selectedClientId)
  const templateNames = [...new Set(templates.filter(t => t.client_id === selectedClientId).map(t => t.template_name || 'Default'))]
  const clientTemplates = templates
    .filter(t => t.client_id === selectedClientId && (t.template_name || 'Default') === selectedTemplateName)
    .sort((a, b) => a.seq_id - b.seq_id)
  const [editingTasks, setEditingTasks] = useState<DbTaskTemplate[] | null>(null)

  function showToast(msg: string, error = false) { setToast({ msg, error }); setTimeout(() => setToast(null), 4000) }

  function selectClient(id: string) {
    setSelectedClientId(id)
    const clientTpls = templates.filter(t => t.client_id === id)
    const names = [...new Set(clientTpls.map(t => t.template_name || 'Default'))]
    const firstName = names[0] || 'Default'
    setSelectedTemplateName(firstName)
    setEditingTasks(null)
    setChannelId(clients.find(c => c.id === id)?.slack_channel_id || '')
  }

  function selectTemplateName(name: string) {
    setSelectedTemplateName(name)
    setEditingTasks(null)
  }

  function handleAddTemplate() {
    const name = newTemplateName.trim()
    if (!name) return
    setSelectedTemplateName(name)
    setEditingTasks(null)
    setAddingTemplate(false)
    setNewTemplateName('')
  }

  const currentTasks = editingTasks ?? clientTemplates

  function updateTaskFields(idx: number, fields: Partial<DbTaskTemplate>) {
    setEditingTasks(prev => {
      const base = prev ?? [...clientTemplates]
      return base.map((t, i) => i === idx ? { ...t, ...fields } : t)
    })
  }

  function updateTask(idx: number, field: keyof DbTaskTemplate, value: unknown) {
    updateTaskFields(idx, { [field]: value } as Partial<DbTaskTemplate>)
  }

  function addTask() {
    const base = editingTasks ?? [...clientTemplates]
    const newSeqId = Math.max(0, ...base.map(t => t.seq_id)) + 1
    const newTask: DbTaskTemplate = {
      id: 'new-' + Date.now(),
      client_id: selectedClientId!,
      template_name: selectedTemplateName,
      seq_id: newSeqId,
      label: '',
      assignee_id: null,
      track: 'Long-form',
      due_days: null,
      note: null,
      dep_seq_ids: [],
      requires_approval: false,
      approver_id: null,
      created_at: new Date().toISOString(),
    }
    setEditingTasks([...base, newTask])
  }

  function removeTask(idx: number) {
    const base = editingTasks ?? [...clientTemplates]
    setEditingTasks(base.filter((_, i) => i !== idx).map((t, i) => ({ ...t, seq_id: i + 1 })))
  }

  async function handleRenameClient(e: React.FormEvent) {
    e.preventDefault()
    const name = clientNameInput.trim()
    if (!name || !selectedClientId) return
    await supabase.from('clients').update({ label: name }).eq('id', selectedClientId)
    setClients(prev => prev.map(c => c.id === selectedClientId ? { ...c, label: name } : c))
    setRenamingClient(false)
    showToast('Client renamed')
  }

  function handleDuplicateClient(clientId: string) {
    setClientMenuOpen(null)
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    const name = 'Copy of ' + client.label
    setDuplicateModal({ clientId, name, key: toClientKey(name) })
  }


  async function handleDeleteClient(clientId: string) {
    setClientMenuOpen(null)
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    if (!confirm(`Delete "${client.label}" and all its templates? This cannot be undone.`)) return
    await supabase.from('task_templates').delete().eq('client_id', clientId)
    await supabase.from('clients').delete().eq('id', clientId)
    setTemplates(prev => prev.filter(t => t.client_id !== clientId))
    const remaining = clients.filter(c => c.id !== clientId)
    setClients(remaining)
    if (remaining.length > 0) selectClient(remaining[0].id)
    else setSelectedClientId(null)
    showToast('Client deleted')
  }

  async function saveTasksNow(tasks: DbTaskTemplate[], silent = false) {
    if (!selectedClientId) return
    setSaving(true)

    const inserts = tasks.map((t, i) => ({
      client_id: selectedClientId,
      template_name: selectedTemplateName,
      seq_id: i + 1,
      label: t.label,
      assignee_id: t.assignee_id || null,
      track: t.track,
      due_days: t.due_days,
      note: t.note,
      dep_seq_ids: t.dep_seq_ids || [],
      requires_approval: t.requires_approval || false,
      approver_id: t.requires_approval ? (t.approver_id || null) : null,
    }))

    const { error: deleteError } = await supabase
      .from('task_templates')
      .delete()
      .eq('client_id', selectedClientId)
      .eq('template_name', selectedTemplateName)

    if (deleteError) {
      setSaving(false)
      showToast(`Save failed: ${deleteError.message}`, true)
      return
    }

    const { data: newTemplates, error: insertError } = await supabase
      .from('task_templates')
      .insert(inserts)
      .select('*, assignee:users!assignee_id(*), approver:users!approver_id(*)')

    if (insertError || !newTemplates) {
      setSaving(false)
      showToast(`Save failed: ${insertError?.message || 'unknown error'}`, true)
      return
    }

    setTemplates(prev => [
      ...prev.filter(t => !(t.client_id === selectedClientId && (t.template_name || 'Default') === selectedTemplateName)),
      ...newTemplates as unknown as DbTaskTemplate[],
    ])
    setEditingTasks(null)
    const savedAt = new Date().toISOString()
    await supabase.from('clients').update({ last_saved_at: savedAt, last_saved_by_name: currentUser.name, slack_channel_id: channelId || null }).eq('id', selectedClientId)
    setClients(prev => prev.map(c => c.id === selectedClientId ? { ...c, last_saved_at: savedAt, last_saved_by_name: currentUser.name, slack_channel_id: channelId || null } : c))
    setSaving(false)
    if (!silent) showToast('Template saved')
  }

  async function saveTemplate() {
    const tasks = editingTasks ?? clientTemplates
    if (tasks.length === 0 || tasks.every(t => !(t.label || '').trim())) {
      showToast('Add at least one task before saving', true)
      return
    }
    await saveTasksNow(tasks)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const tasks = editingTasks ?? clientTemplates
    const oldIndex = tasks.findIndex(t => t.id === active.id)
    const newIndex = tasks.findIndex(t => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(tasks, oldIndex, newIndex)

    // Build old seq_id → new seq_id map
    const oldToNew: Record<number, number> = {}
    reordered.forEach((t, i) => { oldToNew[t.seq_id] = i + 1 })

    // Assign new seq_ids and remap dep_seq_ids
    const remapped = reordered.map((t, i) => ({
      ...t,
      seq_id: i + 1,
      dep_seq_ids: (t.dep_seq_ids || []).map(d => oldToNew[d]).filter(Boolean),
    }))

    setEditingTasks(remapped)
    saveTasksNow(remapped, true)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  async function saveTrigger(update: { trigger_type: 'on_task' | 'on_project' | 'manual'; trigger_seq_id?: number | null; offset_days?: number }) {
    if (!selectedClientId) return
    if (update.trigger_type === 'manual') {
      await supabase.from('pipeline_triggers').delete()
        .eq('client_id', selectedClientId).eq('template_name', selectedTemplateName)
      setTriggers(prev => prev.filter(t => !(t.client_id === selectedClientId && t.template_name === selectedTemplateName)))
      return
    }
    const payload = {
      client_id: selectedClientId,
      template_name: selectedTemplateName,
      trigger_type: update.trigger_type,
      trigger_seq_id: update.trigger_seq_id ?? null,
      offset_days: update.offset_days ?? 3,
    }
    const { data } = await supabase.from('pipeline_triggers')
      .upsert(payload, { onConflict: 'client_id,template_name' }).select().single()
    if (data) {
      setTriggers(prev => [
        ...prev.filter(t => !(t.client_id === selectedClientId && t.template_name === selectedTemplateName)),
        data as PipelineTrigger,
      ])
    }
  }

  async function toggleClientActive(clientId: string, active: boolean) {
    await supabase.from('clients').update({ active }).eq('id', clientId)
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, active } : c))
  }

  function toClientKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  }

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault()
    const key = toClientKey(newClientLabel)
    if (!key) return
    const { data } = await supabase.from('clients').insert({ key, label: newClientLabel }).select().single()
    if (data) {
      setClients(prev => [...prev, data as Client])
      setSelectedClientId(data.id)
      setEditingTasks([])
      setAddingClient(false)
      setNewClientLabel('')
    }
  }

  async function handleConfirmDuplicate() {
    if (!duplicateModal) return
    const { clientId, name, key } = duplicateModal
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    setDuplicateModal(null)
    const { data: newClient } = await supabase.from('clients').insert({
      key,
      label: name,
      active: client.active,
    }).select().single()
    if (!newClient) return
    const allClientTpls = templates.filter(t => t.client_id === clientId)
    if (allClientTpls.length > 0) {
      const inserts = allClientTpls.map(t => ({
        client_id: newClient.id,
        template_name: t.template_name || 'Default',
        seq_id: t.seq_id,
        label: t.label,
        assignee_id: t.assignee_id || null,
        track: t.track,
        due_days: t.due_days,
        note: t.note,
        dep_seq_ids: t.dep_seq_ids || [],
        requires_approval: t.requires_approval || false,
        approver_id: t.approver_id || null,
      }))
      const { data: newTpls } = await supabase.from('task_templates').insert(inserts).select()
      if (newTpls) setTemplates(prev => [...prev, ...(newTpls as DbTaskTemplate[])])
    }
    setClients(prev => [...prev, newClient as Client])
    setSelectedClientId(newClient.id)
    showToast('Client duplicated')
  }

  return (
    <>
    <div className="space-y-4">
      {toast && (
        <div className={cn('rounded-lg px-4 py-2.5 text-sm text-white flex items-center gap-2 border', toast.error ? 'bg-[#1a0a0a] border-[#ff3c00]/50' : 'bg-[#141414] border-[#2e2e2e]')}>
          {toast.error ? <X className="w-4 h-4 text-[#ff3c00] shrink-0" /> : <Check className="w-4 h-4 text-green-400 shrink-0" />}
          {toast.msg}
        </div>
      )}
      <div className="flex gap-5 items-start">
        {/* Client list */}
        <div className="w-48 shrink-0 space-y-1">
          <p className="text-xs font-semibold text-[#555] uppercase tracking-wide mb-2">Clients</p>
          {/* Close menu on outside click */}
          {clientMenuOpen && (
            <div className="fixed inset-0 z-10" onClick={() => setClientMenuOpen(null)} />
          )}
          {clients.map(c => (
            <div key={c.id} className="relative">
              <div
                onClick={() => selectClient(c.id)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between gap-1 cursor-pointer',
                  selectedClientId === c.id ? 'bg-[#ff3c00]/10 text-white border border-[#ff3c00]/30' : 'text-[#888] hover:text-white hover:bg-[#1e1e1e]'
                )}
              >
                <span className="truncate flex-1">{c.label}</span>
                {!c.active && <span className="text-xs text-[#555] shrink-0">off</span>}
                {selectedClientId === c.id && (
                  <button
                    onClick={e => { e.stopPropagation(); setClientMenuOpen(clientMenuOpen === c.id ? null : c.id) }}
                    className="p-0.5 rounded text-[#555] hover:text-white transition-colors shrink-0 z-20 relative"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {clientMenuOpen === c.id && (
                <div className="absolute left-0 top-full mt-1 w-40 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg shadow-xl z-20 overflow-hidden">
                  <button
                    onClick={() => { setClientMenuOpen(null); setClientNameInput(c.label); setRenamingClient(true) }}
                    className="w-full text-left px-3 py-2 text-sm text-[#ccc] hover:bg-[#242424] hover:text-white flex items-center gap-2 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />Rename
                  </button>
                  <button
                    onClick={() => handleDuplicateClient(c.id)}
                    className="w-full text-left px-3 py-2 text-sm text-[#ccc] hover:bg-[#242424] hover:text-white flex items-center gap-2 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />Duplicate
                  </button>
                  <button
                    onClick={() => handleDeleteClient(c.id)}
                    className="w-full text-left px-3 py-2 text-sm text-[#ff3c00] hover:bg-[#ff3c00]/10 flex items-center gap-2 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />Delete
                  </button>
                </div>
              )}
            </div>
          ))}
          <button
            onClick={() => setAddingClient(!addingClient)}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#555] hover:text-white hover:bg-[#1e1e1e] transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />New client
          </button>
          {addingClient && (
            <form onSubmit={handleAddClient} className="space-y-2 pt-1">
              <input value={newClientLabel} onChange={e => setNewClientLabel(e.target.value)} required placeholder="Client name"
                className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#ff3c00] placeholder-[#555]" />
              {newClientLabel && (
                <p className="text-[10px] text-[#555] px-0.5">Key: <span className="text-[#888]">{toClientKey(newClientLabel)}</span></p>
              )}
              <button type="submit" className="w-full py-1.5 bg-[#ff3c00] text-white rounded text-xs font-semibold">Add</button>
            </form>
          )}
        </div>

        {/* Template editor */}
        {selectedClient && (
          <div className="flex-1 min-w-0 space-y-3">
            {/* Pipeline selector */}
            <div className="flex items-center gap-2 flex-wrap">
              {templateNames.map(name => (
                <button
                  key={name}
                  onClick={() => selectTemplateName(name)}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                    selectedTemplateName === name ? 'bg-[#ff3c00] text-white' : 'bg-[#1e1e1e] text-[#888] hover:text-white border border-[#2e2e2e]'
                  )}
                >
                  {name}
                </button>
              ))}
              {!addingTemplate ? (
                <button onClick={() => setAddingTemplate(true)} className="px-2 py-1 text-xs text-[#555] hover:text-white transition-colors">
                  + Add pipeline
                </button>
              ) : (
                <form onSubmit={e => { e.preventDefault(); handleAddTemplate() }} className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={newTemplateName}
                    onChange={e => setNewTemplateName(e.target.value)}
                    placeholder="Pipeline name"
                    className="px-2 py-1 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#ff3c00] placeholder-[#555] w-32"
                  />
                  <button type="submit" className="px-2 py-1 bg-[#ff3c00] text-white rounded text-xs font-semibold">Add</button>
                  <button type="button" onClick={() => { setAddingTemplate(false); setNewTemplateName('') }} className="px-2 py-1 text-[#555] hover:text-white text-xs">Cancel</button>
                </form>
              )}
            </div>

            {/* Auto-launch trigger — only for non-default pipelines */}
            {selectedTemplateName !== 'Default' && (() => {
              const trigger = triggers.find(t => t.client_id === selectedClientId && t.template_name === selectedTemplateName)
              const triggerType = trigger?.trigger_type ?? 'manual'
              const defaultTasks = templates
                .filter(t => t.client_id === selectedClientId && (t.template_name || 'Default') === 'Default')
                .sort((a, b) => a.seq_id - b.seq_id)
              return (
                <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-[#555] uppercase tracking-wider">Auto-launch</p>
                  <div className="flex flex-wrap gap-2">
                    {(['manual', 'on_task', 'on_project'] as const).map(type => (
                      <button
                        key={type}
                        onClick={() => saveTrigger({ trigger_type: type, trigger_seq_id: trigger?.trigger_seq_id, offset_days: trigger?.offset_days ?? 3 })}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                          triggerType === type ? 'bg-[#ff3c00] text-white border-[#ff3c00]' : 'bg-[#1a1a1a] text-[#888] border-[#2e2e2e] hover:text-white'
                        )}
                      >
                        {type === 'manual' ? 'Manual only' : type === 'on_task' ? 'When task completes' : 'When project completes'}
                      </button>
                    ))}
                  </div>

                  {triggerType === 'on_task' && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#666]">Trigger task:</span>
                      <select
                        value={trigger?.trigger_seq_id ?? ''}
                        onChange={e => saveTrigger({ trigger_type: 'on_task', trigger_seq_id: e.target.value ? parseInt(e.target.value) : null, offset_days: trigger?.offset_days ?? 3 })}
                        className="px-2 py-1 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#ff3c00]"
                      >
                        <option value="">— pick a task</option>
                        {defaultTasks.map(t => (
                          <option key={t.seq_id} value={t.seq_id}>{t.seq_id}. {t.label || 'Untitled'}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {triggerType !== 'manual' && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#666]">Release date offset:</span>
                      <span className="text-xs text-[#666]">+</span>
                      <input
                        type="number"
                        min={0}
                        value={trigger?.offset_days ?? 3}
                        onChange={e => saveTrigger({ trigger_type: triggerType as 'on_task' | 'on_project', trigger_seq_id: trigger?.trigger_seq_id, offset_days: parseInt(e.target.value) || 0 })}
                        className="w-12 px-2 py-1 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#ff3c00] text-center"
                      />
                      <span className="text-xs text-[#666]">days after source release date</span>
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="flex items-center justify-between">
              <div>
                {/* Client name — editable */}
                {renamingClient ? (
                  <form onSubmit={handleRenameClient} className="flex items-center gap-2 mb-1">
                    <input
                      autoFocus
                      value={clientNameInput}
                      onChange={e => setClientNameInput(e.target.value)}
                      className="px-3 py-1.5 bg-[#1e1e1e] border border-[#ff3c00] text-white rounded-lg text-2xl font-black focus:outline-none w-64"
                    />
                    <button type="submit" className="p-1.5 bg-[#ff3c00] text-white rounded-lg"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setRenamingClient(false)} className="p-1.5 text-[#555] hover:text-white"><X className="w-4 h-4" /></button>
                  </form>
                ) : (
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-3xl font-black text-white">{selectedClient.label}</h2>
                    <button
                      onClick={() => { setClientNameInput(selectedClient.label); setRenamingClient(true) }}
                      className="p-1.5 rounded-lg text-[#555] hover:text-white hover:bg-[#1e1e1e] transition-colors"
                      title="Rename client"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <p className="text-sm text-[#555]">{currentTasks.length} tasks · {selectedTemplateName}</p>
                {selectedClient.last_saved_at && (
                  <p className="text-xs text-[#555] mt-0.5">
                    Last edited by {selectedClient.last_saved_by_name ?? '—'} · {format(parseISO(selectedClient.last_saved_at), 'MMM d')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-[#555] shrink-0">
                  Slack Channel ID
                  <InfoIcon text="The Slack channel where production notifications for this client will be posted. To find it: open Slack → right-click the channel → View channel details → scroll to the bottom. Starts with C (channel) or U (direct message)." maxWidth={280} />
                </span>
                <input
                  value={channelId}
                  onChange={e => setChannelId(e.target.value)}
                  placeholder="C0123456789"
                  className="px-2 py-1 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#ff3c00] placeholder-[#555] w-32"
                />
                <label className="flex items-center gap-2 text-sm text-[#888] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedClient.active}
                    onChange={e => toggleClientActive(selectedClient.id, e.target.checked)}
                    className="accent-[#ff3c00]"
                  />
                  Active
                </label>
                <button
                  onClick={saveTemplate}
                  disabled={saving}
                  className="px-4 py-1.5 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  {saving ? 'Saving...' : 'Save template'}
                </button>
              </div>
            </div>

            {/* Task rows */}
            <div className="border border-[#2e2e2e] rounded-xl overflow-hidden">
              <div className="grid grid-cols-[20px_28px_minmax(240px,3fr)_130px_160px_80px_160px_160px_28px] gap-3 px-4 py-3 bg-[#101010] border-b border-[#2e2e2e]">
                {['', '#', 'Task', 'Checklist', 'Assignee'].map((h, i) => (
                  <span key={i} className="text-xs font-semibold text-[#555] uppercase tracking-wide">{h}</span>
                ))}
                <span className="text-xs font-semibold text-[#555] uppercase tracking-wide flex items-center gap-1">
                  Days
                  <InfoIcon text="Number of days before the release date this task should be completed. D-5 = 5 days before release, D-1 = 1 day before. Leave blank for tasks with no fixed deadline. Use negative numbers for post-release tasks (e.g. -1 = 1 day after release)." />
                </span>
                <span className="text-xs font-semibold text-[#555] uppercase tracking-wide flex items-center gap-1">
                  Deps
                  <InfoIcon text="Task numbers that must be approved before this task unlocks. Example: entering '1, 2' means this task only becomes available after tasks 1 and 2 are approved." />
                </span>
                <span className="text-xs font-semibold text-[#555] uppercase tracking-wide flex items-center gap-1">
                  Approver
                  <InfoIcon text="The approver must sign off on this task before any dependent tasks unlock. Approval tasks have a 12-hour SLA. Leave empty if no approval is required for this task." />
                </span>
                <span />
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={currentTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  {currentTasks.map((task, idx) => (
                    <SortableTaskRow
                      key={task.id}
                      task={task}
                      idx={idx}
                      allTasks={currentTasks}
                      allUsers={allUsers}
                      onUpdate={updateTask}
                      onRemove={removeTask}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <button
                onClick={addTask}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#555] hover:text-white hover:bg-[#111111] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />Add task
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Duplicate client modal */}
    {duplicateModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDuplicateModal(null)}>
        <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-6 w-80 shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
          <h3 className="text-sm font-semibold text-white">Duplicate client</h3>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-[#555] uppercase tracking-wider block mb-1">Display name</label>
              <input
                value={duplicateModal.name}
                onChange={e => setDuplicateModal(m => m ? { ...m, name: e.target.value, key: toClientKey(e.target.value) } : m)}
                className="w-full px-3 py-2 bg-[#111] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] placeholder-[#555]"
                placeholder="Client name"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[10px] text-[#555] uppercase tracking-wider block mb-1">Key <span className="normal-case text-[#444]">(auto-generated, editable)</span></label>
              <input
                value={duplicateModal.key}
                onChange={e => setDuplicateModal(m => m ? { ...m, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') } : m)}
                className="w-full px-3 py-2 bg-[#111] border border-[#2e2e2e] text-[#888] rounded-lg text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#ff3c00]"
                placeholder="client_key"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setDuplicateModal(null)} className="flex-1 py-2 rounded-lg text-sm text-[#666] hover:text-white border border-[#2e2e2e] hover:border-[#444] transition-colors">
              Cancel
            </button>
            <button
              onClick={handleConfirmDuplicate}
              disabled={!duplicateModal.name.trim() || !duplicateModal.key.trim()}
              className="flex-1 py-2 rounded-lg text-sm font-semibold bg-[#ff3c00] hover:bg-[#e63600] text-white transition-colors disabled:opacity-40"
            >
              Duplicate
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ─── Sortable Task Row ─────────────────────────────────────────────────────────

function SortableTaskRow({ task, idx, allTasks, allUsers, onUpdate, onRemove }: {
  task: DbTaskTemplate
  idx: number
  allTasks: DbTaskTemplate[]
  allUsers: User[]
  onUpdate: (idx: number, field: keyof DbTaskTemplate, value: unknown) => void
  onRemove: (idx: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid grid-cols-[20px_28px_minmax(240px,3fr)_130px_160px_80px_160px_160px_28px] gap-3 px-4 py-3 border-b border-[#242424] last:border-0 items-center',
        isDragging ? 'bg-[#1a1a1a] opacity-90' : 'bg-transparent'
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="text-[#444] hover:text-[#888] cursor-grab active:cursor-grabbing touch-none"
        tabIndex={-1}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span className="text-sm text-[#555] font-mono">{idx + 1}</span>

      <input
        value={task.label}
        onChange={e => onUpdate(idx, 'label', e.target.value)}
        className="px-3 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] w-full"
      />

      <select
        value={task.track}
        onChange={e => onUpdate(idx, 'track', e.target.value as Track)}
        className="px-3 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] w-full"
      >
        {TRACKS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <select
        value={task.assignee_id || ''}
        onChange={e => onUpdate(idx, 'assignee_id', e.target.value || null)}
        className="px-3 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] w-full"
      >
        <option value="">Unassigned</option>
        {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>

      {/* Days */}
      <div className="flex items-center gap-1 w-full">
        <input
          type="number"
          value={task.due_days ?? ''}
          onChange={e => onUpdate(idx, 'due_days', e.target.value ? parseInt(e.target.value) : null)}
          placeholder="—"
          className="px-2 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm w-full focus:outline-none focus:ring-1 focus:ring-[#ff3c00]"
        />
      </div>

      {/* Deps */}
      <div className="flex flex-wrap gap-1">
        {allTasks.filter((_, i) => i !== idx).length === 0 ? (
          <span className="text-xs text-[#444]">—</span>
        ) : (
          allTasks.filter((_, i) => i !== idx).map(t => {
            const selected = (task.dep_seq_ids || []).includes(t.seq_id)
            return (
              <button
                key={t.seq_id}
                type="button"
                title={t.label}
                onClick={() => {
                  const current = task.dep_seq_ids || []
                  onUpdate(idx, 'dep_seq_ids', selected ? current.filter(id => id !== t.seq_id) : [...current, t.seq_id])
                }}
                className={cn(
                  'w-7 h-7 rounded text-xs font-bold transition-colors',
                  selected ? 'bg-[#ff3c00] text-white' : 'bg-[#1e1e1e] text-[#555] hover:text-white border border-[#333]'
                )}
              >
                {t.seq_id}
              </button>
            )
          })
        )}
      </div>

      {/* Approver */}
      <select
        value={task.requires_approval ? (task.approver_id || '') : ''}
        onChange={e => {
          const val = e.target.value
          onUpdate(idx, 'requires_approval', val !== '')
          onUpdate(idx, 'approver_id', val || null)
        }}
        className="px-3 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] w-full"
      >
        <option value="">— No approval</option>
        {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>

      <button
        onClick={() => { if (confirm('Delete this task?')) onRemove(idx) }}
        className="p-0.5 rounded text-[#555] hover:text-[#ff3c00] transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── Integrations Tab ─────────────────────────────────────────────────────────

function IntegrationsTab() {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<{ connected: boolean; workspaceName: string | null; tokenHint: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    fetch('/api/admin/slack', { cache: 'no-store' }).then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const res = await fetch('/api/admin/slack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Failed to connect'); setSaving(false); return }
    setStatus({ connected: true, workspaceName: data.workspaceName, tokenHint: '…' + token.slice(-4) })
    setToken('')
    setToast('Slack connected!')
    setTimeout(() => setToast(''), 3000)
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div className="bg-[#141414] border border-[#2e2e2e] rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#1e1e1e] rounded-lg flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 text-[#ff3c00]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-white">Slack</h3>
            <p className="text-xs text-[#666]">Post Block Kit notifications to client channels</p>
          </div>
          {status && (
            status.connected
              ? <span className="text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full shrink-0">Connected · {status.workspaceName}</span>
              : <span className="text-xs font-medium text-[#888] bg-[#1e1e1e] px-2 py-0.5 rounded-full shrink-0">Not connected</span>
          )}
        </div>

        {toast && <p className="text-sm text-green-400">{toast}</p>}
        {error && <p className="text-sm text-[#ff3c00]">{error}</p>}

        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[#ccc] mb-1.5">
              Bot Token{status?.tokenHint && <span className="text-[#555] font-normal ml-1">({status.tokenHint})</span>}
            </label>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              required
              placeholder="xoxb-..."
              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]"
            />
            <p className="text-xs text-[#555] mt-1">
              From your Slack app&apos;s &ldquo;OAuth &amp; Permissions&rdquo; page. Requires <code className="text-[#888]">chat:write</code> scope.
            </p>
          </div>
          <button
            type="submit"
            disabled={saving || !token}
            className="px-4 py-2 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {saving ? 'Connecting...' : status?.connected ? 'Update token' : 'Connect Slack'}
          </button>
        </form>
      </div>
      <p className="text-xs text-[#555]">
        Set each client&apos;s Slack channel ID in Clients &amp; Templates → select a client → the channel field next to &ldquo;Active&rdquo;.
      </p>
    </div>
  )
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  locked: '#444', ready: '#3b82f6', in_progress: '#f59e0b',
  in_review: '#8b5cf6', approved: '#10b981', revision: '#ff3c00', done: '#10b981',
}

function ActivityActor({ actor }: { actor: ActivityEntry['actor'] }) {
  if (!actor) {
    return (
      <span className="flex items-center gap-1 shrink-0">
        <Link2 className="w-3 h-3 text-[#444]" />
        <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Auto</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span
        className="flex items-center justify-center rounded-full text-white font-bold shrink-0"
        style={{ width: 18, height: 18, fontSize: 9, background: actor.avatar_color || '#444' }}
      >
        {actor.name[0].toUpperCase()}
      </span>
      <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{actor.name.split(' ')[0]}</span>
    </span>
  )
}

function ActivityTab({ activity }: { activity: ActivityEntry[] }) {
  const grouped: Record<string, ActivityEntry[]> = {}
  for (const entry of activity) {
    const day = entry.changed_at.slice(0, 10)
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(entry)
  }

  if (activity.length === 0) {
    return (
      <div className="text-center py-16 text-[#555]">
        <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-bold text-white">No activity yet</p>
        <p className="text-sm mt-1">Task status changes will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([day, entries]) => (
        <div key={day}>
          <p className="text-xs font-semibold text-[#555] uppercase tracking-wide mb-2">
            {format(parseISO(day), 'MMMM d, yyyy')}
          </p>
          <div className="border border-[#2e2e2e] rounded-xl overflow-hidden divide-y divide-[#242424]">
            {entries.map(entry => (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#111111] transition-colors">
                {/* Task label + episode */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-medium text-white truncate">{entry.task?.label ?? '—'}</span>
                  {entry.episode && (
                    <span className="text-xs text-[#555] shrink-0">— {entry.episode.guest_name} / {entry.episode.client_label}</span>
                  )}
                </div>
                {/* Actor */}
                <span className="text-[#333] shrink-0">·</span>
                <ActivityActor actor={entry.actor} />
                {/* Status badges or note */}
                <div className="flex items-center gap-2 shrink-0">
                  {entry.note && entry.from_status === entry.to_status ? (
                    <span className="text-xs text-[#666]">{entry.note}</span>
                  ) : (
                    <>
                      {entry.from_status && (
                        <>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: STATUS_COLORS[entry.from_status] + '22', color: STATUS_COLORS[entry.from_status] }}>
                            {entry.from_status.replace('_', ' ')}
                          </span>
                          <span className="text-[#444]">→</span>
                        </>
                      )}
                      {entry.to_status && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: STATUS_COLORS[entry.to_status] + '22', color: STATUS_COLORS[entry.to_status] }}>
                          {entry.to_status.replace('_', ' ')}
                        </span>
                      )}
                    </>
                  )}
                  <span className="text-xs text-[#555]">{format(parseISO(entry.changed_at), 'h:mm a')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}


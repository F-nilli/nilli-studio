'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Client, DbTaskTemplate, ActivityEntry, UserRole, Track, canManageTeam } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { cn, formatDate } from '@/lib/utils'
import { TRACK_COLORS } from '@/lib/constants'
import { Users, Building2, Activity, Plus, Trash2, RefreshCw, ChevronDown, Check, X, Zap, Pencil, Copy, MoreHorizontal } from 'lucide-react'
import { format, parseISO } from 'date-fns'

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

interface Props {
  currentUser: User
  allUsers: User[]
  taskCountByUser: Record<string, number>
  clients: Client[]
  templates: DbTaskTemplate[]
  activity: ActivityEntry[]
}

export function SettingsClient({ currentUser, allUsers, taskCountByUser, clients, templates, activity }: Props) {
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
        <h1 className="text-3xl font-black text-white">Settings</h1>
        <p className="text-[#888] text-base mt-1">Manage your team, clients, and production history</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[#2e2e2e]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
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
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('member')
  const [inviteColor, setInviteColor] = useState(AVATAR_COLORS[1])
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError('')
    setInviteLoading(true)
    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, name: inviteName, role: inviteRole, avatarColor: inviteColor }),
    })
    const data = await res.json()
    if (!res.ok) { setInviteError(data.error); setInviteLoading(false); return }
    showToast(`${inviteName} invited — temp password: Nilli2026!`)
    setInviteEmail(''); setInviteName(''); setInviteRole('member'); setShowInvite(false)
    const { data: updatedUsers } = await supabase.from('users').select('*').order('name')
    if (updatedUsers) setUsers(updatedUsers as User[])
    setInviteLoading(false)
  }

  async function handleRoleChange(userId: string, newRole: UserRole) {
    setActionLoading(userId + '-role')
    await supabase.from('users').update({ role: newRole }).eq('id', userId)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
    setActionLoading(null)
    showToast('Role updated')
  }

  async function handleRemove(userId: string) {
    if (!confirm('Remove this user? This cannot be undone.')) return
    setActionLoading(userId + '-remove')
    await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    setUsers(prev => prev.filter(u => u.id !== userId))
    setActionLoading(null)
    showToast('User removed')
  }

  async function handleResetPassword(userId: string) {
    setActionLoading(userId + '-reset')
    await fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' })
    setActionLoading(null)
    showToast('Password reset email sent')
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="bg-[#141414] border border-[#2e2e2e] rounded-lg px-4 py-2.5 text-sm text-white flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400" />{toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[#888]">{users.length} members</p>
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
        <form onSubmit={handleInvite} className="bg-[#141414] border border-[#2e2e2e] rounded-xl p-5 space-y-4">
          <h3 className="font-bold text-white">Invite new member</h3>
          {inviteError && <p className="text-sm text-[#ff3c00]">{inviteError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#888] mb-1 block">Full name</label>
              <input value={inviteName} onChange={e => setInviteName(e.target.value)} required placeholder="Jane Smith"
                className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]" />
            </div>
            <div>
              <label className="text-xs text-[#888] mb-1 block">Email</label>
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required placeholder="jane@studio.com"
                className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] placeholder-[#555]" />
            </div>
          </div>
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
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setInviteColor(c)}
                    className={cn('w-7 h-7 rounded-full border-2 transition-all', inviteColor === c ? 'border-white scale-110' : 'border-transparent')}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowInvite(false)}
              className="px-4 py-2 text-sm text-[#888] hover:text-white transition-colors">Cancel</button>
            <button type="submit" disabled={inviteLoading}
              className="px-4 py-2 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors">
              {inviteLoading ? 'Inviting...' : 'Send invite'}
            </button>
          </div>
        </form>
      )}

      {/* Users table */}
      <div className="border border-[#2e2e2e] rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_80px_100px] px-4 py-2 bg-[#101010] border-b border-[#2e2e2e]">
          <span className="text-xs font-semibold text-[#555] uppercase tracking-wide">Member</span>
          <span className="text-xs font-semibold text-[#555] uppercase tracking-wide">Role</span>
          <span className="text-xs font-semibold text-[#555] uppercase tracking-wide">Tasks</span>
          <span className="text-xs font-semibold text-[#555] uppercase tracking-wide">Actions</span>
        </div>
        {users.map(u => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === currentUser.id}
            isAdmin={isAdmin}
            activeTasks={taskCountByUser[u.id] || 0}
            actionLoading={actionLoading}
            onRoleChange={handleRoleChange}
            onRemove={handleRemove}
            onResetPassword={handleResetPassword}
          />
        ))}
      </div>
    </div>
  )
}

function UserRow({ user, isSelf, isAdmin, activeTasks, actionLoading, onRoleChange, onRemove, onResetPassword }: {
  user: User; isSelf: boolean; isAdmin: boolean; activeTasks: number
  actionLoading: string | null
  onRoleChange: (id: string, role: UserRole) => void
  onRemove: (id: string) => void
  onResetPassword: (id: string) => void
}) {
  const [showRoleMenu, setShowRoleMenu] = useState(false)

  return (
    <div className="grid grid-cols-[1fr_140px_80px_100px] px-4 py-3 border-b border-[#242424] last:border-0 items-center hover:bg-[#111111] transition-colors group">
      {/* Name + email */}
      <div className="flex items-center gap-3 min-w-0">
        <Avatar name={user.name} color={user.avatar_color} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{user.name} {isSelf && <span className="text-[#555] text-xs">(you)</span>}</p>
          <p className="text-xs text-[#666] truncate">{user.email}</p>
        </div>
      </div>

      {/* Role */}
      <div className="relative">
        {isAdmin && !isSelf ? (
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
          <button onClick={() => onResetPassword(user.id)} disabled={actionLoading === user.id + '-reset'} title="Send password reset"
            className="p-1 rounded hover:bg-[#1e1e1e] text-[#555] hover:text-white transition-colors">
            <RefreshCw className="w-3 h-3" />
          </button>
          <button onClick={() => onRemove(user.id)} disabled={actionLoading === user.id + '-remove'} title="Remove user"
            className="p-1 rounded hover:bg-[#ff3c00]/20 text-[#555] hover:text-[#ff3c00] transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Clients Tab ──────────────────────────────────────────────────────────────

function ClientsTab({ currentUser, clients: initialClients, templates: initialTemplates, allUsers }: {
  currentUser: User; clients: Client[]; templates: DbTaskTemplate[]; allUsers: User[]
}) {
  const supabase = createClient()
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [templates, setTemplates] = useState<DbTaskTemplate[]>(initialTemplates)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(initialClients[0]?.id || null)
  const [addingClient, setAddingClient] = useState(false)
  const [newClientLabel, setNewClientLabel] = useState('')
  const [newClientKey, setNewClientKey] = useState('')
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
  const [editingTasks, setEditingTasks] = useState<DbTaskTemplate[]>([])

  function showToast(msg: string, error = false) { setToast({ msg, error }); setTimeout(() => setToast(null), 4000) }

  function selectClient(id: string) {
    setSelectedClientId(id)
    const clientTpls = templates.filter(t => t.client_id === id)
    const names = [...new Set(clientTpls.map(t => t.template_name || 'Default'))]
    const firstName = names[0] || 'Default'
    setSelectedTemplateName(firstName)
    setEditingTasks([])
    setChannelId(clients.find(c => c.id === id)?.slack_channel_id || '')
  }

  function selectTemplateName(name: string) {
    setSelectedTemplateName(name)
    setEditingTasks([])
  }

  function handleAddTemplate() {
    const name = newTemplateName.trim()
    if (!name) return
    setSelectedTemplateName(name)
    setEditingTasks([])
    setAddingTemplate(false)
    setNewTemplateName('')
  }

  const currentTasks = editingTasks.length > 0 ? editingTasks : clientTemplates

  function updateTaskFields(idx: number, fields: Partial<DbTaskTemplate>) {
    setEditingTasks(prev => {
      const base = prev.length > 0 ? prev : [...clientTemplates]
      return base.map((t, i) => i === idx ? { ...t, ...fields } : t)
    })
  }

  function updateTask(idx: number, field: keyof DbTaskTemplate, value: unknown) {
    updateTaskFields(idx, { [field]: value } as Partial<DbTaskTemplate>)
  }

  function addTask() {
    const base = editingTasks.length > 0 ? editingTasks : [...clientTemplates]
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
      due_after_dep_hours: null,
      note: null,
      dep_seq_ids: [],
      requires_approval: false,
      approver_id: null,
      created_at: new Date().toISOString(),
    }
    setEditingTasks([...base, newTask])
  }

  function removeTask(idx: number) {
    const base = editingTasks.length > 0 ? editingTasks : [...clientTemplates]
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

  async function handleDuplicateClient(clientId: string) {
    setClientMenuOpen(null)
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    const { data: newClient } = await supabase.from('clients').insert({
      key: client.key + '_copy_' + Date.now(),
      label: 'Copy of ' + client.label,
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
        due_after_dep_hours: t.due_after_dep_hours || null,
        note: t.note,
        dep_seq_ids: t.dep_seq_ids || [],
        requires_approval: t.requires_approval || false,
        approver_id: t.approver_id || null,
      }))
      const { data: newTpls } = await supabase.from('task_templates').insert(inserts).select('*, assignee:users!assignee_id(*), approver:users!approver_id(*)')
      if (newTpls) setTemplates(prev => [...prev, ...newTpls as unknown as DbTaskTemplate[]])
    }
    const newClientData = newClient as Client
    setClients(prev => [...prev, newClientData])
    selectClient(newClient.id)
    showToast(`"${newClientData.label}" created`)
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

  async function saveTemplate() {
    if (!selectedClientId) return
    setSaving(true)
    const tasks = editingTasks.length > 0 ? editingTasks : clientTemplates

    const inserts = tasks.map((t, i) => ({
      client_id: selectedClientId,
      template_name: selectedTemplateName,
      seq_id: i + 1,
      label: t.label,
      assignee_id: t.assignee_id || null,
      track: t.track,
      due_days: t.due_after_dep_hours ? null : t.due_days,
      due_after_dep_hours: t.due_after_dep_hours || null,
      note: t.note,
      dep_seq_ids: t.dep_seq_ids || [],
      requires_approval: t.requires_approval || false,
      approver_id: t.requires_approval ? (t.approver_id || null) : null,
    }))

    // Guard: don't wipe data if there's nothing valid to save
    if (inserts.length === 0 || inserts.every(t => !(t.label || '').trim())) {
      setSaving(false)
      showToast('Add at least one task before saving', true)
      return
    }

    // Delete only this pipeline — not other pipelines for the same client
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

    // Replace only the current pipeline in state — leave other pipelines intact
    setTemplates(prev => [
      ...prev.filter(t => !(t.client_id === selectedClientId && (t.template_name || 'Default') === selectedTemplateName)),
      ...newTemplates as unknown as DbTaskTemplate[],
    ])
    setEditingTasks([])
    const savedAt = new Date().toISOString()
    await supabase.from('clients').update({ last_saved_at: savedAt, last_saved_by_name: currentUser.name, slack_channel_id: channelId || null }).eq('id', selectedClientId)
    setClients(prev => prev.map(c => c.id === selectedClientId ? { ...c, last_saved_at: savedAt, last_saved_by_name: currentUser.name, slack_channel_id: channelId || null } : c))
    setSaving(false)
    showToast('Template saved')
  }

  async function toggleClientActive(clientId: string, active: boolean) {
    await supabase.from('clients').update({ active }).eq('id', clientId)
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, active } : c))
  }

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault()
    const { data } = await supabase.from('clients').insert({ key: newClientKey, label: newClientLabel }).select().single()
    if (data) {
      setClients(prev => [...prev, data as Client])
      setSelectedClientId(data.id)
      setEditingTasks([])
      setAddingClient(false)
      setNewClientLabel(''); setNewClientKey('')
    }
  }

  return (
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
              <input value={newClientKey} onChange={e => setNewClientKey(e.target.value)} required placeholder="client_key (no spaces)"
                className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#ff3c00] placeholder-[#555]" />
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
                <input
                  value={channelId}
                  onChange={e => setChannelId(e.target.value)}
                  placeholder="#channel-id"
                  title="Slack Channel ID"
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
              <div className="grid grid-cols-[28px_minmax(240px,3fr)_130px_160px_80px_160px_160px_28px] gap-3 px-4 py-3 bg-[#101010] border-b border-[#2e2e2e]">
                {['#', 'Task', 'Checklist', 'Assignee', 'Days', 'Deps', 'Approver', ''].map(h => (
                  <span key={h} className="text-xs font-semibold text-[#555] uppercase tracking-wide">{h}</span>
                ))}
              </div>
              {currentTasks.map((task, idx) => (
                <div key={task.id} className="grid grid-cols-[28px_minmax(240px,3fr)_130px_160px_80px_160px_160px_28px] gap-3 px-4 py-3 border-b border-[#242424] last:border-0 items-center">
                  <span className="text-sm text-[#555] font-mono">{idx + 1}</span>
                  <input
                    value={task.label}
                    onChange={e => updateTask(idx, 'label', e.target.value)}
                    className="px-3 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] w-full"
                  />
                  <select
                    value={task.track}
                    onChange={e => updateTask(idx, 'track', e.target.value as Track)}
                    className="px-3 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] w-full"
                  >
                    {TRACKS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select
                    value={task.assignee_id || ''}
                    onChange={e => updateTask(idx, 'assignee_id', e.target.value || null)}
                    className="px-3 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] w-full"
                  >
                    <option value="">Unassigned</option>
                    {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  {/* Days: D-X mode or +Xhr-after-dep mode */}
                  <div className="flex items-center gap-1 w-full">
                    {task.due_after_dep_hours != null ? (
                      <>
                        <span className="text-[#555] text-sm shrink-0">+</span>
                        <input
                          type="number"
                          value={task.due_after_dep_hours ?? ''}
                          onChange={e => updateTask(idx, 'due_after_dep_hours', e.target.value ? parseInt(e.target.value) : null)}
                          className="px-2 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm w-12 focus:outline-none focus:ring-1 focus:ring-[#ff3c00]"
                        />
                        <span className="text-[#555] text-sm shrink-0">h</span>
                        <button type="button" title="Switch to D-X mode"
                          onClick={() => updateTaskFields(idx, { due_after_dep_hours: null, due_days: null })}
                          className="text-[#555] hover:text-white text-xs px-1 shrink-0">D</button>
                      </>
                    ) : (
                      <>
                        <input
                          type="number"
                          value={task.due_days ?? ''}
                          onChange={e => updateTask(idx, 'due_days', e.target.value ? parseInt(e.target.value) : null)}
                          placeholder="—"
                          className="px-2 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm w-full focus:outline-none focus:ring-1 focus:ring-[#ff3c00]"
                        />
                        <button type="button" title="+Xhr after dep completion"
                          onClick={() => updateTaskFields(idx, { due_after_dep_hours: 24, due_days: null })}
                          className="text-[#555] hover:text-white text-sm px-1 shrink-0">⚡</button>
                      </>
                    )}
                  </div>
                  {/* Deps: pill toggles */}
                  <div className="flex flex-wrap gap-1">
                    {currentTasks.filter((_, i) => i !== idx).length === 0 ? (
                      <span className="text-xs text-[#444]">—</span>
                    ) : (
                      currentTasks.filter((_, i) => i !== idx).map(t => {
                        const selected = (task.dep_seq_ids || []).includes(t.seq_id)
                        return (
                          <button
                            key={t.seq_id}
                            type="button"
                            title={t.label}
                            onClick={() => {
                              const current = task.dep_seq_ids || []
                              updateTask(idx, 'dep_seq_ids', selected ? current.filter(id => id !== t.seq_id) : [...current, t.seq_id])
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
                  {/* Approver: "—" = no approval needed, else pick a team member */}
                  <select
                    value={task.requires_approval ? (task.approver_id || '') : ''}
                    onChange={e => {
                      const val = e.target.value
                      updateTask(idx, 'requires_approval', val !== '')
                      updateTask(idx, 'approver_id', val || null)
                    }}
                    className="px-3 py-2 bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] w-full"
                  >
                    <option value="">— No approval</option>
                    {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <button onClick={() => removeTask(idx)} className="p-0.5 rounded text-[#555] hover:text-[#ff3c00] transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
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
    fetch('/api/admin/slack').then(r => r.json()).then(setStatus).catch(() => {})
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

function ActivityTab({ activity }: { activity: ActivityEntry[] }) {
  const grouped: Record<string, ActivityEntry[]> = {}
  for (const entry of activity) {
    const day = entry.created_at.slice(0, 10)
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
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-medium text-white truncate">{entry.detail.task_label}</span>
                  {entry.episode && (
                    <span className="text-xs text-[#555] shrink-0">— {entry.episode.guest_name} / {entry.episode.client_label}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {entry.detail.from_status && (
                    <>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: STATUS_COLORS[entry.detail.from_status] + '22', color: STATUS_COLORS[entry.detail.from_status] }}>
                        {entry.detail.from_status?.replace('_', ' ')}
                      </span>
                      <span className="text-[#444]">→</span>
                    </>
                  )}
                  {entry.detail.to_status && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: STATUS_COLORS[entry.detail.to_status] + '22', color: STATUS_COLORS[entry.detail.to_status] }}>
                      {entry.detail.to_status?.replace('_', ' ')}
                    </span>
                  )}
                  <span className="text-xs text-[#555]">{format(parseISO(entry.created_at), 'h:mm a')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}


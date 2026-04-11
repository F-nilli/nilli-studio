'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Search, X, Bell, MessageSquare, ChevronLeft, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { playCoinSound } from '@/lib/notification-sound'
import { NotificationDrawer } from './NotificationDrawer'
import { MessagesDrawer } from './MessagesDrawer'
import { NewEpisodeModal, type CreatedEpisode } from './NewEpisodeModal'
import { cn } from '@/lib/utils'
import type { User, NotificationType } from '@/lib/types'

const SIDEBAR_EXPANDED = 240
const SIDEBAR_COLLAPSED = 64

const TASK_NOTIF_TYPES: NotificationType[] = [
  'task_unlocked',
  'task_submitted_review',
  'task_approved',
  'task_revision',
  'task_overdue',
]

const PLACEHOLDERS = [
  'Search episodes, tasks…',
  'Try "John Smith"…',
  'Find a task by name…',
  'Search by client…',
  'Search by guest name…',
]

interface SearchResult {
  type: 'episode' | 'task'
  id: string
  title: string
  subtitle: string
  href: string
}

interface PresenceUser {
  userId: string
  name: string
  avatarColor?: string
}

interface Toast {
  episodeId: string
  guestName: string
  clientLabel: string
}

interface Props {
  user?: User
  collapsed?: boolean
  onToggle?: () => void
}

export function TopBar({ user, collapsed = false, onToggle }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'ops_manager'

  // Search
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(-1)
  const [searchFocused, setSearchFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Badge counts
  const [taskNotifCount, setTaskNotifCount] = useState(0)
  const [msgNotifCount, setMsgNotifCount] = useState(0)

  // Drawer state
  const [showNotifDrawer, setShowNotifDrawer] = useState(false)
  const [showMsgDrawer, setShowMsgDrawer] = useState(false)

  // Animated placeholder
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [placeholderFading, setPlaceholderFading] = useState(false)

  // Breadcrumb
  const [breadcrumbEpisode, setBreadcrumbEpisode] = useState<{ client_label: string; guest_name: string } | null>(null)

  // New Episode modal + toast
  const [showNewEpisodeModal, setShowNewEpisodeModal] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  // Manifesto modal
  const [showManifesto, setShowManifesto] = useState(false)

  // Presence
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([])
  const [showPresenceTooltip, setShowPresenceTooltip] = useState(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isIdleRef = useRef(false)

  // ── Badge counts ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    fetchCounts()
    const channel = supabase
      .channel(`topbar-badges-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => {
        setTaskNotifCount(c => c + 1)
        playCoinSound()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, fetchCounts)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, fetchCounts)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_notifications', filter: `user_id=eq.${user.id}` }, () => {
        setMsgNotifCount(c => c + 1)
        playCoinSound()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_notifications', filter: `user_id=eq.${user.id}` }, fetchCounts)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_notifications', filter: `user_id=eq.${user.id}` }, fetchCounts)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id])

  async function fetchCounts() {
    if (!user) return
    const [notifRes, msgRes] = await Promise.all([
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false).in('type', TASK_NOTIF_TYPES),
      supabase.from('message_notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false),
    ])
    setTaskNotifCount(notifRes.count ?? 0)
    setMsgNotifCount(msgRes.count ?? 0)
  }

  function handleCloseNotifDrawer() { setShowNotifDrawer(false); fetchCounts() }
  function handleCloseMsgDrawer() { setShowMsgDrawer(false); fetchCounts() }

  // ── Animated placeholder ──────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderFading(true)
      setTimeout(() => {
        setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length)
        setPlaceholderFading(false)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // ── ⌘K shortcut ──────────────────────────────────────────────────────────
  useEffect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onGlobalKey)
    return () => document.removeEventListener('keydown', onGlobalKey)
  }, [])

  // ── Manifesto Escape ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!showManifesto) return
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setShowManifesto(false) }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [showManifesto])

  // ── Breadcrumb episode fetch ──────────────────────────────────────────────
  useEffect(() => {
    setBreadcrumbEpisode(null)
    const match = pathname.match(/^\/episodes\/([^/]+)/)
    if (match) {
      const episodeId = match[1]
      supabase.from('episodes').select('client_label, guest_name').eq('id', episodeId).single()
        .then(({ data }) => { if (data) setBreadcrumbEpisode(data) })
    }
  }, [pathname])

  // ── Presence ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return

    const channel = supabase.channel('online-users', {
      config: { presence: { key: user.id } },
    })

    function syncPresence() {
      const state = channel.presenceState<PresenceUser>()
      const users: PresenceUser[] = []
      for (const presences of Object.values(state)) {
        const p = (presences as PresenceUser[])[0]
        if (p && p.userId !== user!.id) users.push(p)
      }
      setOnlineUsers(users)
    }

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ userId: user.id, name: user.name, avatarColor: user.avatar_color, isIdle: false })
        }
      })

    // Idle detection
    const IDLE_TIMEOUT = 10 * 60 * 1000
    function resetIdle() {
      if (isIdleRef.current) {
        isIdleRef.current = false
        channel.track({ userId: user!.id, name: user!.name, avatarColor: user!.avatar_color, isIdle: false })
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        isIdleRef.current = true
        channel.track({ userId: user!.id, name: user!.name, avatarColor: user!.avatar_color, isIdle: true })
      }, IDLE_TIMEOUT)
    }
    resetIdle()
    document.addEventListener('mousemove', resetIdle)
    document.addEventListener('keydown', resetIdle)

    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      if (!isIdleRef.current) {
        channel.track({ userId: user.id, name: user.name, avatarColor: user.avatar_color })
      }
    }, 30_000)

    return () => {
      document.removeEventListener('mousemove', resetIdle)
      document.removeEventListener('keydown', resetIdle)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      clearInterval(heartbeat)
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  // ── Toast auto-dismiss ────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // ── Search helpers ────────────────────────────────────────────────────────
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => { setQuery(''); setOpen(false); setResults([]) }, [pathname])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(() => runSearch(query.trim()), 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  async function runSearch(q: string) {
    setLoading(true)
    const term = `%${q}%`
    const [episodesRes, tasksRes] = await Promise.all([
      supabase.from('episodes').select('id, guest_name, client_label').or(`guest_name.ilike.${term},client_label.ilike.${term}`).is('published_at', null).limit(5),
      supabase.from('tasks').select('id, label, episode_id, episodes(guest_name)').ilike('label', term).not('status', 'in', '(\"locked\",\"done\",\"approved\")').limit(5),
    ])
    const episodeResults: SearchResult[] = (episodesRes.data ?? []).map(ep => ({ type: 'episode', id: ep.id, title: ep.guest_name, subtitle: ep.client_label, href: `/episodes/${ep.id}` }))
    const taskResults: SearchResult[] = (tasksRes.data ?? []).map((t: any) => ({ type: 'task', id: t.id, title: t.label, subtitle: t.episodes?.guest_name ?? '', href: `/episodes/${t.episode_id}` }))
    setResults([...episodeResults, ...taskResults])
    setOpen(true)
    setSelected(-1)
    setLoading(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, -1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const target = selected >= 0 ? results[selected] : results[0]
      if (target) { router.push(target.href); setOpen(false); setQuery('') }
    } else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  function clear() { setQuery(''); setResults([]); setOpen(false); inputRef.current?.focus() }

  // ── Breadcrumb label ──────────────────────────────────────────────────────
  function getBreadcrumb() {
    if (pathname.startsWith('/episodes/') && breadcrumbEpisode) {
      return (
        <span className="flex items-center gap-1.5 text-[13px]">
          <Link href="/board" className="text-[#555] hover:text-[#888] transition-colors">Board</Link>
          <span className="text-[#333]">›</span>
          <span className="text-[#777]">{breadcrumbEpisode.client_label}</span>
          <span className="text-[#333]">›</span>
          <span className="text-white font-medium">{breadcrumbEpisode.guest_name}</span>
        </span>
      )
    }
    if (pathname.startsWith('/board')) return <span className="text-[13px] text-[#666]">Board</span>
    if (pathname.startsWith('/calendar')) return <span className="text-[13px] text-[#666]">Calendar</span>
    if (pathname.startsWith('/settings')) return <span className="text-[13px] text-[#666]">Settings</span>
    if (pathname.startsWith('/profile')) return <span className="text-[13px] text-[#666]">Profile</span>
    return null
  }

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push('/board')
    }
  }

  const breadcrumb = getBreadcrumb()
  const onlineCount = onlineUsers.length

  return (
    <>
      <header
        className="h-[68px] border-b border-[#141414] flex items-center sticky top-0 z-30 bg-[#0a0a0a]/98 backdrop-blur-sm shrink-0 relative overflow-visible"
      >
        {/* ── LEFT ZONE: back button + breadcrumb (episode only) | page label ── */}
        <div className="flex items-center pl-3 shrink-0">
          {breadcrumbEpisode ? (
            <div className="hidden md:flex items-center" style={{ gap: 8 }}>
              <button
                onClick={handleBack}
                className="cursor-pointer"
                style={{ color: 'rgba(255,255,255,0.5)', transition: 'color 150ms', lineHeight: 0 }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.9)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
              >
                <ChevronLeft style={{ width: 18, height: 18 }} />
              </button>
              {breadcrumb}
            </div>
          ) : breadcrumb && (
            <div className="hidden md:flex items-center">{breadcrumb}</div>
          )}
        </div>

        {/* ── CENTER ZONE: logo, truly centered on viewport ─────── */}
        <div
          className="absolute flex items-center justify-center pointer-events-none"
          style={{
            left: `calc(50vw - ${sidebarWidth}px)`,
            transform: 'translateX(-50%)',
            transition: 'left 200ms',
            top: 0,
            height: '68px',
            paddingTop: '14px',
            paddingBottom: '14px',
          }}
        >
          <button
            onClick={() => setShowManifesto(true)}
            className="pointer-events-auto h-full flex items-center cursor-pointer"
            style={{ background: 'none', border: 'none', padding: 0, transition: 'opacity 150ms' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            <Image
              src="/logo.png"
              alt="Nilli Studio"
              width={288}
              height={105}
              className="h-full w-auto object-contain"
              priority
            />
          </button>
        </div>

        {/* ── RIGHT ZONE: presence + new episode + icons + search ── */}
        <div className="ml-auto flex items-center gap-4 shrink-0" style={{ paddingRight: 20 }}>

          {/* Presence pill */}
          {user && (
            <div
              className="relative hidden md:block"
              onMouseEnter={() => setShowPresenceTooltip(true)}
              onMouseLeave={() => setShowPresenceTooltip(false)}
            >
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-default select-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: '#34d399', boxShadow: '0 0 5px #34d399' }}
                />
                <span className="text-[12px] text-[#666]">
                  {onlineCount === 0 ? 'Just you' : `${onlineCount + 1} online`}
                </span>
              </div>
              {showPresenceTooltip && onlineCount > 0 && (
                <div className="absolute right-0 top-full mt-1.5 bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl shadow-2xl z-50 overflow-hidden min-w-[140px]">
                  <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-[#444] uppercase tracking-widest">Online now</p>
                  {onlineUsers.map(u => (
                    <div key={u.userId} className="px-3 py-1.5 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-[13px] text-white">{u.name}</span>
                    </div>
                  ))}
                  <div className="h-2" />
                </div>
              )}
            </div>
          )}

          {/* New Episode button */}
          {user && isAdminOrManager && (
            <button
              onClick={() => setShowNewEpisodeModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold text-black transition-all hover:scale-[1.02] cursor-pointer shrink-0"
              style={{ background: 'linear-gradient(to bottom, #ff9a30, #e8820a)', border: '1px solid #f7931a', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Episode</span>
            </button>
          )}

          {/* Icons pill */}
          {user && (
            <div
              className="flex items-center"
              style={{
                gap: 16,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 100,
                padding: '6px 12px',
              }}
            >
              <IconButton
                onClick={() => { setShowMsgDrawer(true); setShowNotifDrawer(false) }}
                color="#38bdf8"
                hasUnread={msgNotifCount > 0}
                count={msgNotifCount}
                tooltip="Messages"
              >
                <MessageSquare style={{ width: 22, height: 22 }} />
              </IconButton>

              <IconButton
                onClick={() => { setShowNotifDrawer(true); setShowMsgDrawer(false) }}
                color="#f7931a"
                hasUnread={taskNotifCount > 0}
                count={taskNotifCount}
                tooltip="Notifications"
              >
                <Bell style={{ width: 22, height: 22 }} />
              </IconButton>
            </div>
          )}

          {/* Search */}
          <div className="relative" ref={containerRef}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#444] pointer-events-none z-10" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => { setSearchFocused(true); if (results.length > 0) setOpen(true) }}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder=""
              className="bg-[#1a1a1a] border border-[#272727] rounded-lg pl-8 pr-7 py-1.5 text-sm text-white focus:outline-none focus:border-[#383838] transition-all duration-200"
              style={{ width: searchFocused ? 320 : 220 }}
            />
            {/* Animated placeholder overlay */}
            {!query && (
              <span
                className="absolute left-8 top-1/2 -translate-y-1/2 text-sm text-[#555] pointer-events-none select-none transition-opacity duration-300 flex items-center gap-1.5"
                style={{ opacity: searchFocused || placeholderFading ? 0 : 1 }}
              >
                {PLACEHOLDERS[placeholderIdx]}
                <span className="text-[11px] text-[#333] font-mono">⌘K</span>
              </span>
            )}
            {query && (
              <button onClick={clear} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#888] cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {open && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-[#141414] border border-[#2e2e2e] rounded-xl shadow-2xl overflow-hidden z-50">
                {loading && <div className="px-4 py-3 text-sm text-[#555]">Searching…</div>}
                {!loading && results.length === 0 && <div className="px-4 py-3 text-sm text-[#555]">No results for "{query}"</div>}
                {!loading && results.length > 0 && (() => {
                  const episodes = results.filter(r => r.type === 'episode')
                  const tasks = results.filter(r => r.type === 'task')
                  let idx = -1
                  return (
                    <>
                      {episodes.length > 0 && (
                        <>
                          <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-[#444] uppercase tracking-widest">Episodes</p>
                          {episodes.map(r => { idx++; const i = idx; return (
                            <button key={r.id} onClick={() => { router.push(r.href); setOpen(false); setQuery('') }} onMouseEnter={() => setSelected(i)}
                              className={cn('w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer', selected === i ? 'bg-[#1e1e1e]' : 'hover:bg-[#1a1a1a]')}>
                              <span className="w-1.5 h-1.5 rounded-full bg-[#ff3c00] shrink-0" />
                              <div className="min-w-0"><p className="text-sm font-medium text-white truncate">{r.title}</p><p className="text-xs text-[#555] truncate">{r.subtitle}</p></div>
                            </button>
                          )})}
                        </>
                      )}
                      {tasks.length > 0 && (
                        <>
                          <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-[#444] uppercase tracking-widest">Tasks</p>
                          {tasks.map(r => { idx++; const i = idx; return (
                            <button key={r.id} onClick={() => { router.push(r.href); setOpen(false); setQuery('') }} onMouseEnter={() => setSelected(i)}
                              className={cn('w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer', selected === i ? 'bg-[#1e1e1e]' : 'hover:bg-[#1a1a1a]')}>
                              <span className="w-1.5 h-1.5 rounded-full bg-[#555] shrink-0" />
                              <div className="min-w-0"><p className="text-sm font-medium text-white truncate">{r.title}</p><p className="text-xs text-[#555] truncate">{r.subtitle}</p></div>
                            </button>
                          )})}
                        </>
                      )}
                      <div className="px-3 py-2 border-t border-[#1e1e1e]">
                        <p className="text-[10px] text-[#333]">↑↓ navigate · Enter to open · Esc to close</p>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      </header>

      {showNotifDrawer && user && <NotificationDrawer user={user} onClose={handleCloseNotifDrawer} />}
      {showMsgDrawer && user && <MessagesDrawer user={user} onClose={handleCloseMsgDrawer} />}
      {showManifesto && <ManifestoModal onClose={() => setShowManifesto(false)} />}

      {showNewEpisodeModal && user && (
        <NewEpisodeModal
          currentUser={user}
          onClose={() => setShowNewEpisodeModal(false)}
          onSuccess={(episode: CreatedEpisode) => {
            setShowNewEpisodeModal(false)
            setToast({ episodeId: episode.id, guestName: episode.guest_name, clientLabel: episode.client_label })
          }}
        />
      )}

      {/* Success toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl"
          style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <span className="w-2 h-2 rounded-full bg-[#f7931a] shrink-0" />
          <span className="text-sm text-white">
            Episode created — <span className="font-semibold">{toast.guestName}</span> / {toast.clientLabel}
          </span>
          <Link
            href={`/episodes/${toast.episodeId}`}
            className="text-sm text-[#f7931a] hover:text-[#ff9a30] font-medium transition-colors whitespace-nowrap"
          >
            View →
          </Link>
          <button onClick={() => setToast(null)} className="text-[#555] hover:text-white transition-colors ml-1 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  )
}

// ─── Icon button with pulse, badge, tooltip ───────────────────────────────────

interface IconButtonProps {
  onClick: () => void
  color: string
  hasUnread: boolean
  count: number
  tooltip: string
  children: React.ReactNode
}

function IconButton({ onClick, color, hasUnread, count, tooltip, children }: IconButtonProps) {
  const badgeSize = count > 9 ? 22 : 18

  return (
    <div className="relative group flex flex-col items-center">
      <button
        onClick={onClick}
        className="relative flex items-center justify-center transition-transform duration-150 cursor-pointer group-hover:scale-[1.15]"
        style={{ color, opacity: hasUnread ? 1 : 0.7 }}
      >
        {hasUnread && (
          <span
            className="pulse-ring pulse-ring-animated"
            style={{ color }}
          />
        )}

        {children}

        {count > 0 && (
          <span
            className="absolute flex items-center justify-center bg-[#ff3c00] text-white font-bold rounded-full"
            style={{
              fontSize: 10,
              width: badgeSize,
              height: badgeSize,
              top: -badgeSize / 2 + 2,
              right: -badgeSize / 2 + 2,
              lineHeight: 1,
            }}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-[#1e1e1e] border border-[#2e2e2e] rounded text-[11px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl">
        {tooltip}
      </div>
    </div>
  )
}

// ─── Brand Manifesto Modal ────────────────────────────────────────────────────

const MANIFESTO_SECTIONS = [
  {
    heading: 'WHO WE ARE',
    body: `Nilli Studio is a premium video production studio built for content creators who take their work seriously.\n\nWe handle everything after the record button stops: editing, packaging, distribution-ready assets, thumbnails, clips, trailers, so creators can focus on what only they can do: show up and create.\n\nWe're not a marketplace. We're not a freelance platform. We're a studio with a team, a process, and a standard.`,
  },
  {
    heading: 'WHAT WE BELIEVE',
    body: `Great content doesn't spread because it exists. It spreads because it's packaged, positioned, and released with intention.\n\nMost creators are sitting on valuable content that never reaches the audience it deserves — not because the content is bad, but because the production is an afterthought.\n\nWe believe the edit is part of the message. The thumbnail is part of the pitch. The clip is part of the reach. We treat every deliverable as if the creator's reputation depends on it, because it does.`,
  },
  {
    heading: 'BITCOIN FIRST',
    body: `We're not neutral about money. We believe in sound money, sovereign individuals, and building things that last.\n\nBitcoin isn't a side note at Nilli Studio. It's part of how we think. About ownership. About value. About the kind of work worth doing. We serve the Bitcoin media ecosystem with the same conviction the space deserves.`,
  },
  {
    heading: 'WHY THIS TOOL EXISTS',
    body: `This app is how we run the studio. Every task, every deadline, every approval, every deliverable: visible, tracked, and moving forward.\n\nWe built it because we couldn't find anything good enough. Now it runs us.`,
  },
  {
    heading: 'OUR STANDARD',
    body: `We don't ship average work. If it's leaving our hands it's ready. If it's not ready it doesn't leave.\n\nThat's not a tagline. That's how we operate.`,
  },
]

const SOCIAL_LINKS = [
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/@nillistudio',
    icon: (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="3.5" width="14" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <path d="M6.5 5.8l4 2.2-4 2.2V5.8z" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/nillistudio/',
    icon: (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <circle cx="11.5" cy="4.5" r="0.75" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: 'Nostr',
    href: 'https://primal.net/nillistudio',
    nostr: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <path d="M8.5 1.5L5.5 8h3.5L7 14.5l7-8.5h-4l2-4.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="none" />
      </svg>
    ),
  },
  {
    label: 'X',
    href: 'https://x.com/nillistudio',
    icon: (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <path d="M2.5 2.5L13.5 13.5M13.5 2.5L2.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Website',
    href: 'https://www.nillistudio.com/',
    icon: (
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <ellipse cx="8" cy="8" rx="2.5" ry="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <line x1="2.2" y1="6" x2="13.8" y2="6" stroke="currentColor" strokeWidth="1.2" />
        <line x1="2.2" y1="10" x2="13.8" y2="10" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
]

function ManifestoModal({ onClose }: { onClose: () => void }) {
  const [entering, setEntering] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setEntering(true)))
  }, [])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: entering ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        transition: 'background 250ms ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 680,
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: '#111111',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 48,
          opacity: entering ? 1 : 0,
          transform: entering ? 'scale(1)' : 'scale(0.96)',
          transition: 'opacity 250ms ease, transform 250ms ease',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 20,
            right: 24,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 20,
            lineHeight: 1,
            padding: '4px 6px',
            borderRadius: 4,
            transition: 'color 150ms',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.9)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
          aria-label="Close"
        >
          ×
        </button>

        {/* Logo header */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <Image
            src="/logo.png"
            alt="Nilli Studio"
            width={288}
            height={105}
            style={{ width: 120, height: 'auto' }}
            priority
          />
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', marginBottom: 32 }} />

        {/* Manifesto sections */}
        {MANIFESTO_SECTIONS.map((section, i) => (
          <div key={section.heading} style={{ marginBottom: i < MANIFESTO_SECTIONS.length - 1 ? 32 : 0 }}>
            <p style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.35)',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}>
              {section.heading}
            </p>
            {section.body.split('\n\n').map((para, j) => (
              <p key={j} style={{
                fontSize: 15,
                fontWeight: 400,
                lineHeight: 1.8,
                color: 'rgba(255,255,255,0.82)',
                marginBottom: j < section.body.split('\n\n').length - 1 ? 16 : 0,
              }}>
                {para}
              </p>
            ))}
          </div>
        ))}

        {/* Footer */}
        <div style={{ marginTop: 32 }}>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', marginBottom: 24 }} />

          {/* Social icons */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 16 }}>
            {SOCIAL_LINKS.map(link => (
              <ModalSocialIcon key={link.label} href={link.href} label={link.label} nostr={!!link.nostr}>
                {link.icon}
              </ModalSocialIcon>
            ))}
          </div>

          {/* Copyright */}
          <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
            © Nilli Studio · Built in-house
          </p>
        </div>
      </div>
    </div>
  )
}

function ModalSocialIcon({ href, label, nostr, children }: { href: string; label: string; nostr: boolean; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)

  return (
    <span
      role="link"
      tabIndex={0}
      aria-label={label}
      onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
      onKeyDown={e => e.key === 'Enter' && window.open(href, '_blank', 'noopener,noreferrer')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: hovered
          ? nostr ? '#a855f7' : 'rgba(255,255,255,0.7)'
          : 'rgba(255,255,255,0.3)',
        transition: 'color 150ms',
      }}
    >
      {children}
    </span>
  )
}

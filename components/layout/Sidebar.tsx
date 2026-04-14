'use client'

import Link from 'next/link'
import { useState, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutGrid, Calendar, Layers2, Settings, User as UserIcon,
  LogOut, ChevronLeft, ChevronRight, BarChart2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import type { User as UserType } from '@/lib/types'
import { canAccessSettings } from '@/lib/types'

interface SidebarProps {
  user: UserType
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ user, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const roleLabel =
    user.role === 'admin' ? 'Admin' :
    user.role === 'ops_manager' ? 'Manager' :
    'Member'

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
    { href: '/board', label: 'Project Board', icon: Layers2 },
    { href: '/calendar', label: 'Calendar', icon: Calendar },
    { href: '/analytics', label: 'Analytics', icon: BarChart2 },
  ]

  function navClass(isActive: boolean, extraHover = '') {
    return cn(
      'snav flex items-center rounded-lg min-h-[48px] relative group transition-colors',
      isActive
        ? 'snav-active border-l-[3px] border-[#f7931a] text-white'
        : cn('border-l-[3px] border-transparent text-[#777] hover:text-white', extraHover),
      collapsed ? 'justify-center w-full' : 'pl-5 pr-5 gap-3'
    )
  }

  function Tooltip({ label }: { label: string }) {
    return (
      <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-xs text-white whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl">
        {label}
      </span>
    )
  }

  return (
    <div
      className={cn(
        'fixed left-0 top-0 h-screen flex flex-col z-40 transition-[width] duration-200',
        'border-r border-[#141414]',
        collapsed ? 'w-16' : 'w-60'
      )}
      style={{ background: 'radial-gradient(ellipse at 60% 0%, rgba(247,147,26,0.05) 0%, transparent 60%), #161616' }}
    >
      {/* ── Header: user profile + toggle ───────────────── */}
      <div className="border-b border-[#111] shrink-0">
        {/* 1. User profile block */}
        <div className={cn(
          'flex items-center',
          collapsed ? 'justify-center pt-4 pb-3 px-2' : 'gap-2 pt-4 pb-3 px-4'
        )}>
          <Avatar name={user.name} color={user.avatar_color} size="lg" avatarUrl={user.avatar_url} />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-white truncate leading-tight">{user.name}</p>
              <p className="text-[11px] font-normal mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{roleLabel}</p>
            </div>
          )}
        </div>

        {/* 2. Subtle divider + toggle arrow */}
        <div
          className={cn(
            'flex items-center py-1',
            collapsed ? 'justify-center' : 'px-2'
          )}
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          <button
            onClick={onToggle}
            className="p-2 rounded-md text-[#444] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed
              ? <ChevronRight className="w-4 h-4" />
              : <ChevronLeft className="w-4 h-4" />
            }
          </button>
        </div>
      </div>

      {/* ── Main nav ────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {!collapsed && (
          <p className="text-[10px] font-semibold text-[#333] uppercase tracking-[0.1em] px-3 mb-2">
            Menu
          </p>
        )}

        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={navClass(isActive)}
              title={collapsed ? label : undefined}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="text-[15px] font-medium">{label}</span>}
              {collapsed && <Tooltip label={label} />}
            </Link>
          )
        })}
      </nav>

      {/* ── Bottom section ──────────────────────────────── */}
      <div className="border-t border-[#111] py-3 px-2 space-y-0.5 shrink-0">
        {canAccessSettings(user) && (
          <Link
            href="/settings"
            className={navClass(pathname.startsWith('/settings'))}
            title={collapsed ? 'Settings' : undefined}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {!collapsed && <span className="text-[15px] font-medium">Settings</span>}
            {collapsed && <Tooltip label="Settings" />}
          </Link>
        )}

        <Link
          href="/profile"
          className={navClass(pathname.startsWith('/profile'))}
          title={collapsed ? 'Profile' : undefined}
        >
          <UserIcon className="w-5 h-5 shrink-0" />
          {!collapsed && <span className="text-[15px] font-medium">Profile</span>}
          {collapsed && <Tooltip label="Profile" />}
        </Link>

        <button
          onClick={handleSignOut}
          title={collapsed ? 'Log out' : undefined}
          className={cn(navClass(false, 'hover:text-[#ff3c00]'), 'w-full text-left')}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span className="text-[15px] font-medium">Log out</span>}
          {collapsed && <Tooltip label="Log out" />}
        </button>

        {!collapsed && <SocialLinks />}
      </div>
    </div>
  )
}

function SocialLinks() {
  const links = [
    {
      label: 'YouTube',
      href: 'https://www.youtube.com/@nillistudio',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="3.5" width="14" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M6.5 5.8l4 2.2-4 2.2V5.8z" fill="currentColor" />
        </svg>
      ),
    },
    {
      label: 'Instagram',
      href: 'https://www.instagram.com/nillistudio/',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8.5 1.5L5.5 8h3.5L7 14.5l7-8.5h-4l2-4.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="none" />
        </svg>
      ),
    },
    {
      label: 'X',
      href: 'https://x.com/nillistudio',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2.5 2.5L13.5 13.5M13.5 2.5L2.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: 'Website',
      href: 'https://www.nillistudio.com/',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <ellipse cx="8" cy="8" rx="2.5" ry="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <line x1="2.2" y1="6" x2="13.8" y2="6" stroke="currentColor" strokeWidth="1.2" />
          <line x1="2.2" y1="10" x2="13.8" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      ),
    },
  ]

  return (
    <div style={{ marginTop: 12, paddingLeft: 16, paddingRight: 16 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {links.map(({ label, href, icon, nostr }) => (
          <SocialIcon key={label} label={label} href={href} icon={icon} nostr={!!nostr} />
        ))}
      </div>
    </div>
  )
}

function SocialIcon({ label, href, icon, nostr }: { label: string; href: string; icon: React.ReactNode; nostr: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [showTip, setShowTip] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const [tipPos, setTipPos] = useState({ left: 0, top: 0 })

  function handleEnter() {
    setHovered(true)
    timerRef.current = setTimeout(() => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      setTipPos({ left: rect.left + rect.width / 2, top: rect.top - 6 })
      setShowTip(true)
    }, 400)
  }

  function handleLeave() {
    setHovered(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    setShowTip(false)
  }

  const color = hovered
    ? nostr ? '#a855f7' : 'rgba(255,255,255,0.7)'
    : 'rgba(255,255,255,0.25)'

  return (
    <>
      <span
        ref={ref}
        role="link"
        tabIndex={0}
        onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
        onKeyDown={(e) => e.key === 'Enter' && window.open(href, '_blank', 'noopener,noreferrer')}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          transition: 'color 150ms',
          cursor: 'pointer',
          flexShrink: 0,
        }}
        aria-label={label}
      >
        {icon}
      </span>
      {showTip && (
        <span
          style={{
            position: 'fixed',
            left: tipPos.left,
            top: tipPos.top,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
            background: '#2a2a2a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            color: 'rgba(255,255,255,0.85)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      )}
    </>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, LogOut, User, LayoutDashboard, Calendar, Trello, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { cn, formatDate } from '@/lib/utils'
import type { User as UserType, Notification } from '@/lib/types'

interface NavbarProps {
  user: UserType
}

export function Navbar({ user }: NavbarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchNotifications()
    // Subscribe to real-time notifications
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        fetchNotifications()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user.id])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false)
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function fetchNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setNotifications(data)
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const unreadCount = notifications.filter(n => !n.read).length

  const navLinks = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/calendar', label: 'Calendar', icon: Calendar },
    ...(user.role === 'admin' ? [{ href: '/board', label: 'Board', icon: Trello }] : []),
  ]

  return (
    <nav className="h-20 bg-[#161717] border-b border-[#2e2e2e] flex items-center px-8 sticky top-0 z-40">
      {/* Nav Links — left */}
      <div className="flex items-center gap-1 flex-1">
        {navLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-base font-semibold transition-colors',
              pathname.startsWith(href)
                ? 'bg-[#ff3c00] text-white'
                : 'text-[#888] hover:text-white hover:bg-white/5'
            )}
          >
            <Icon className="w-5 h-5" />
            {label}
          </Link>
        ))}
      </div>

      {/* Logo — center */}
      <Link href="/dashboard" className="absolute left-1/2 -translate-x-1/2">
        <Image src="/logo.png" alt="Nilli Studio" width={200} height={72} className="h-16 w-auto object-contain" priority />
      </Link>

      <div className="flex items-center gap-2 flex-1 justify-end">
        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => {
              setShowNotifications(!showNotifications)
              if (!showNotifications) markAllRead()
            }}
            className="relative p-2.5 rounded-lg text-[#888] hover:text-white hover:bg-white/5 transition-colors"
          >
            <Bell className="w-6 h-6" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-[#ff3c00] rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-full mt-1 w-80 bg-[#1e1e1e] border border-[#2e2e2e] rounded-lg shadow-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2e2e2e]">
                <h3 className="font-semibold text-sm text-white">Notifications</h3>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-[#888]">
                    No notifications
                  </div>
                ) : (
                  notifications.map(n => (
                    <div
                      key={n.id}
                      className={cn(
                        'px-4 py-3 border-b border-[#2e2e2e] last:border-0',
                        !n.read && 'bg-[#ff3c00]/5'
                      )}
                    >
                      <p className="text-sm font-medium text-white">{n.title}</p>
                      <p className="text-xs text-[#888] mt-0.5">{n.body}</p>
                      <p className="text-xs text-[#555] mt-1">{formatDate(n.created_at)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
          >
            <Avatar name={user.name} color={user.avatar_color} size="sm" />
            <span className="text-base font-semibold text-white hidden sm:block">{user.name}</span>
            <ChevronDown className="w-4 h-4 text-[#888] hidden sm:block" />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-[#1e1e1e] border border-[#2e2e2e] rounded-lg shadow-xl overflow-hidden">
              <Link
                href="/profile"
                className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#ccc] hover:text-white hover:bg-white/5"
                onClick={() => setShowUserMenu(false)}
              >
                <User className="w-4 h-4" />
                Profile
              </Link>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#ff3c00] hover:bg-white/5"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}

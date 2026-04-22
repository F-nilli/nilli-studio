'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { MobileNav } from './MobileNav'
import { UserContext } from '@/lib/contexts/UserContext'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@/lib/types'

const SIDEBAR_EXPANDED = 240
const SIDEBAR_COLLAPSED = 64

export function SidebarLayout({ user: initialUser, children }: { user: User; children: React.ReactNode }) {
  const supabase = createClient()
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [currentUser, setCurrentUser] = useState<User>(initialUser)

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved !== null) setCollapsed(saved === 'true')
    setMounted(true)
  }, [])

  // Subscribe to realtime user profile changes (current user only — covers multi-tab edits)
  useEffect(() => {
    const channel = supabase
      .channel(`user-profile-${initialUser.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${initialUser.id}` },
        (payload) => {
          setCurrentUser(prev => ({ ...prev, ...(payload.new as Partial<User>) }))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [initialUser.id])

  function handleToggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebar-collapsed', String(next))
  }

  const pathname = usePathname()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const marginLeft = mounted && !isMobile ? (collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED) : 0

  return (
    <UserContext.Provider value={{ user: currentUser, setUser: setCurrentUser }}>
      <div className="flex min-h-screen">
        <Sidebar user={currentUser} collapsed={collapsed} onToggle={handleToggle} />
        <div
          className="flex-1 flex flex-col min-h-screen"
          style={{
            marginLeft,
            transition: mounted && !isMobile ? 'margin-left 200ms' : 'none',
          }}
        >
          <TopBar user={currentUser} collapsed={collapsed} onToggle={handleToggle} isMobile={isMobile} />
          <main className="flex-1 px-4 md:px-8 py-4 md:py-8 max-w-[1400px] w-full mx-auto overflow-x-clip pb-20 md:pb-8">
            <div key={pathname} className="min-h-full">
              {children}
            </div>
          </main>
        </div>
      </div>
      <MobileNav />
    </UserContext.Provider>
  )
}

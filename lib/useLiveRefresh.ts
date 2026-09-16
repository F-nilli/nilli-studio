'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Reconcile whole snapshots, including inserts, deletes and missed socket events.
// Keep local form state: router.refresh does not remount client components.
export function useLiveRefresh(paused = false) {
  const router = useRouter()
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const [, tick] = useState(0)
  useEffect(() => {
    const supabase = createClient()
    let pending: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const refresh = () => {
      if (!disposed && !pausedRef.current && document.visibilityState === 'visible' && navigator.onLine) {
        router.refresh()
      }
    }
    const schedule = () => {
      if (pending) return
      pending = setTimeout(() => { pending = undefined; refresh() }, 500)
    }
    const resume = () => { tick(n => n + 1); schedule() }
    const channel = supabase.channel(`live-reconcile-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'episodes' }, schedule)
      .subscribe(status => { if (status === 'SUBSCRIBED') schedule() })
    const recovery = setInterval(refresh, 15000)
    const clock = setInterval(() => {
      if (document.visibilityState === 'visible') tick(n => n + 1)
    }, 10000)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => {
      disposed = true
      clearTimeout(pending)
      clearInterval(recovery)
      clearInterval(clock)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
      void supabase.removeChannel(channel)
    }
  }, [router])
}

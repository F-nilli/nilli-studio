'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Bell, CheckCircle, RotateCcw, Clock, LockOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn, formatRelativeTime } from '@/lib/utils'
import type { User, Notification, NotificationType } from '@/lib/types'

interface Props {
  user: User
  onClose: () => void
}

const TASK_TYPES: NotificationType[] = [
  'task_unlocked',
  'task_submitted_review',
  'task_approved',
  'task_revision',
  'task_overdue',
]

function NotifIcon({ type }: { type: NotificationType }) {
  if (type === 'task_unlocked') return <LockOpen className="w-4 h-4 text-blue-400" />
  if (type === 'task_submitted_review') return <Bell className="w-4 h-4 text-[#ff3c00]" />
  if (type === 'task_approved') return <CheckCircle className="w-4 h-4 text-green-400" />
  if (type === 'task_revision') return <RotateCcw className="w-4 h-4 text-red-400" />
  if (type === 'task_overdue') return <Clock className="w-4 h-4 text-red-400" />
  return <Bell className="w-4 h-4 text-[#888]" />
}

export function NotificationDrawer({ user, onClose }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchNotifications()
    const channel = supabase
      .channel(`notif-drawer-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => fetchNotifications())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user.id])

  async function fetchNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .in('type', TASK_TYPES)
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setNotifications(data as Notification[])
    setLoading(false)
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)
      .in('type', TASK_TYPES)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function handleClick(n: Notification) {
    if (!n.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', n.id)
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))
    }
    onClose()
    if (n.episode_id) {
      const url = n.task_id
        ? `/episodes/${n.episode_id}?t=${n.task_id}`
        : `/episodes/${n.episode_id}`
      router.push(url)
    }
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[380px] border-l z-50 flex flex-col shadow-2xl" style={{ background: '#1a1a1a', borderColor: 'rgba(255,255,255,0.09)', boxShadow: '-20px 0 60px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e1e] shrink-0">
          <h2 className="text-[15px] font-semibold text-white">Notifications</h2>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-[#666] hover:text-white transition-colors cursor-pointer"
              >
                Mark all as read
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#1e1e1e] text-[#555] hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-[#555]">Loading…</div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 pb-16">
              <Bell className="w-8 h-8 text-[#333]" />
              <p className="text-sm text-[#555]">You're all caught up</p>
            </div>
          ) : (
            notifications.map(n => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  'w-full text-left px-5 py-4 border-b border-[#111] hover:bg-[#141414] transition-colors cursor-pointer',
                  !n.read && 'border-l-2 border-l-[#ff3c00] bg-[#ff3c00]/[0.03] pl-[18px]'
                )}
              >
                <div className="flex gap-3">
                  <div className="shrink-0 mt-0.5">
                    <NotifIcon type={n.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white leading-snug">{n.title}</p>
                    <p className="text-xs text-[#888] mt-0.5 leading-relaxed">{n.body}</p>
                    <p className="text-[11px] text-[#555] mt-1.5">{formatRelativeTime(n.created_at)}</p>
                  </div>
                  {!n.read && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#ff3c00] shrink-0 mt-1.5" />
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}

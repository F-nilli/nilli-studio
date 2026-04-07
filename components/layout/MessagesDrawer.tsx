'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { cn, formatRelativeTime } from '@/lib/utils'
import type { User, MessageNotification } from '@/lib/types'

interface Props {
  user: User
  onClose: () => void
}

function renderPreview(body: string, currentUserName: string) {
  const truncated = body.length > 80 ? body.slice(0, 80) + '…' : body
  const parts = truncated.split(/(@\w+(?:\s\w+)?)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const mentioned = part.slice(1).trim().toLowerCase()
      const isSelf = currentUserName.toLowerCase().startsWith(mentioned) || mentioned.startsWith(currentUserName.toLowerCase().split(' ')[0])
      return (
        <span key={i} className={isSelf ? 'text-[#ff3c00] font-medium' : 'text-[#f7931a]/80'}>
          {part}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function MessagesDrawer({ user, onClose }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [messages, setMessages] = useState<MessageNotification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMessages().then(markAllReadDB)
    const channel = supabase
      .channel(`msg-drawer-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'message_notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => fetchMessages())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user.id])

  async function fetchMessages() {
    const { data } = await supabase
      .from('message_notifications')
      .select(`
        *,
        author:users!author_id(id, name, avatar_color, avatar_url),
        comment:comments!comment_id(body),
        task:tasks!task_id(label),
        episode:episodes!episode_id(guest_name, client_label)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setMessages(data as unknown as MessageNotification[])
    setLoading(false)
  }

  async function markAllReadDB() {
    await supabase
      .from('message_notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)
  }

  async function markAllRead() {
    await markAllReadDB()
    setMessages(prev => prev.map(m => ({ ...m, read: true })))
  }

  async function handleClick(m: MessageNotification) {
    if (!m.read) {
      await supabase.from('message_notifications').update({ read: true }).eq('id', m.id)
      setMessages(prev => prev.map(x => x.id === m.id ? { ...x, read: true } : x))
    }
    onClose()
    const url = m.task_id
      ? `/episodes/${m.episode_id}?t=${m.task_id}&c=${m.comment_id}`
      : `/episodes/${m.episode_id}`
    router.push(url)
  }

  const unreadCount = messages.filter(m => !m.read).length

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[380px] border-l z-50 flex flex-col shadow-2xl" style={{ background: '#1a1a1a', borderColor: 'rgba(255,255,255,0.09)', boxShadow: '-20px 0 60px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e1e] shrink-0">
          <h2 className="text-[15px] font-semibold text-white">Messages</h2>
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
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 pb-16">
              <MessageSquare className="w-8 h-8 text-[#333]" />
              <p className="text-sm text-[#555]">No messages yet</p>
            </div>
          ) : (
            messages.map(m => {
              const author = m.author as any
              const authorName: string = author?.name ?? 'Unknown'
              const authorColor: string = author?.avatar_color ?? '#888'
              const authorAvatarUrl: string | null = author?.avatar_url ?? null
              const commentBody: string = (m.comment as any)?.body ?? ''
              const taskLabel: string = (m.task as any)?.label ?? ''
              const episodeGuest: string = (m.episode as any)?.guest_name ?? ''
              const episodeClient: string = (m.episode as any)?.client_label ?? ''

              return (
                <button
                  key={m.id}
                  onClick={() => handleClick(m)}
                  className={cn(
                    'w-full text-left px-5 py-4 border-b border-[#111] hover:bg-[#141414] transition-colors cursor-pointer',
                    !m.read && 'border-l-2 border-l-[#ff3c00] bg-[#ff3c00]/[0.03] pl-[18px]'
                  )}
                >
                  <div className="flex gap-3">
                    {/* Avatar with internal badge */}
                    <div className="shrink-0 mt-0.5">
                      <Avatar name={authorName} color={authorColor} size="sm" avatarUrl={authorAvatarUrl} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white leading-snug">
                        @{authorName}
                        {m.type === 'mention' && taskLabel && (
                          <span className="font-normal text-[#666]"> mentioned you in {taskLabel}</span>
                        )}
                        {m.type === 'mention' && !taskLabel && (
                          <span className="font-normal text-[#666]"> mentioned you</span>
                        )}
                        {m.type === 'task_comment' && taskLabel && (
                          <span className="font-normal text-[#666]"> commented on your task {taskLabel}</span>
                        )}
                        {m.type === 'task_comment' && !taskLabel && (
                          <span className="font-normal text-[#666]"> commented on your task</span>
                        )}
                      </p>
                      <p className="text-xs text-[#777] mt-0.5 leading-relaxed line-clamp-2">
                        {renderPreview(commentBody, user.name)}
                      </p>
                      {(episodeGuest || episodeClient) && (
                        <p className="text-[11px] text-[#444] mt-1">
                          {episodeGuest}{episodeClient ? ` · ${episodeClient}` : ''}
                        </p>
                      )}
                      <p className="text-[11px] text-[#555] mt-1">{formatRelativeTime(m.created_at)}</p>
                    </div>

                    {!m.read && (
                      <div className="w-1.5 h-1.5 rounded-full bg-[#ff3c00] shrink-0 mt-1.5" />
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

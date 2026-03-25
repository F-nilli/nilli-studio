'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Comment, User, Task } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { sendNotification } from '@/lib/notifications'
import { format, isToday, isYesterday } from 'date-fns'
import { cn } from '@/lib/utils'

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}hr ago`
  const d = new Date(iso)
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

function renderBody(body: string) {
  const parts = body.split(/(@\w+)/g)
  return parts.map((part, i) =>
    part.startsWith('@')
      ? <span key={i} className="text-[#f7931a] font-medium">{part}</span>
      : <span key={i}>{part}</span>
  )
}

interface Props {
  episodeId: string
  episodeClientKey: string
  episodeGuestName: string
  episodeClientLabel: string
  allComments: Comment[]
  taskLabels: Record<string, string>
  currentUser: User
  allUsers: User[]
  activeTask: Task | null
  onClearFilter: () => void
  onNewComment: (comment: Comment) => void
}

export function CommentPanel({
  episodeId,
  episodeClientKey,
  episodeGuestName,
  episodeClientLabel,
  allComments,
  taskLabels,
  currentUser,
  allUsers,
  activeTask,
  onClearFilter,
  onNewComment,
}: Props) {
  const supabase = createClient()
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const visibleComments = activeTask
    ? allComments.filter(c => c.task_id === activeTask.id)
    : allComments

  // Scroll to bottom on new comments
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [visibleComments.length])

  // @mention dropdown options
  const mentionOptions = mentionQuery !== null
    ? allUsers.filter(u => u.id !== currentUser.id && u.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : []

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setBody(val)

    // Detect @mention
    const caret = e.target.selectionStart ?? val.length
    const before = val.slice(0, caret)
    const match = before.match(/@(\w*)$/)
    if (match) {
      setMentionQuery(match[1])
      setMentionStart(caret - match[0].length)
    } else {
      setMentionQuery(null)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (mentionQuery !== null && mentionOptions.length > 0) {
        insertMention(mentionOptions[0])
      } else {
        handleSubmit()
      }
    }
    if (e.key === 'Escape') setMentionQuery(null)
  }

  function insertMention(user: User) {
    const before = body.slice(0, mentionStart)
    const after = body.slice(inputRef.current?.selectionStart ?? body.length)
    const newBody = `${before}@${user.name} ${after}`
    setBody(newBody)
    setMentionQuery(null)
    inputRef.current?.focus()
  }

  async function handleSubmit() {
    if (!body.trim() || !activeTask) return
    setSubmitting(true)

    const { data } = await supabase
      .from('comments')
      .insert({ task_id: activeTask.id, author_id: currentUser.id, body: body.trim() })
      .select('*, author:users(*)')
      .single()

    if (data) {
      const newComment = data as unknown as Comment
      onNewComment(newComment)
      setBody('')
      setMentionQuery(null)

      // @mention notifications
      const mentioned = body.match(/@(\w+)/g)?.map(m => m.slice(1)) ?? []
      for (const username of mentioned) {
        const mentionedUser = allUsers.find(u => u.name === username)
        if (mentionedUser && mentionedUser.id !== currentUser.id) {
          await sendNotification(supabase, {
            userId: mentionedUser.id,
            type: 'task_comment_mention',
            title: `@${currentUser.name} mentioned you`,
            body: `In "${activeTask.label}": ${body.trim().slice(0, 80)}`,
            taskId: activeTask.id,
            episodeId,
          })
        }
      }

      // Slack notification for the comment
      fetch('/api/slack/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'comment',
          episodeId,
          taskLabel: activeTask.label,
          authorName: currentUser.name,
          commentBody: body.trim(),
        }),
      }).catch(() => {})
    }

    setSubmitting(false)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] bg-[#0f0f0f] border border-[#242424] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#242424] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-[#666] uppercase tracking-wider shrink-0">Comments</span>
          {activeTask && (
            <>
              <span className="text-[#333] text-xs">·</span>
              <span className="text-xs text-[#888] truncate font-medium">{activeTask.label}</span>
            </>
          )}
        </div>
        {activeTask && (
          <button
            onClick={onClearFilter}
            className="p-1 rounded hover:bg-[#1e1e1e] text-[#555] hover:text-white transition-colors shrink-0 ml-2"
            title="Show all comments"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {visibleComments.length === 0 && (
          <p className="text-center text-xs text-[#444] py-8">
            {activeTask ? 'No comments on this task yet.' : 'No comments yet.'}
          </p>
        )}
        {visibleComments.map(comment => {
          const isOwn = comment.author_id === currentUser.id
          return (
            <div key={comment.id} className={cn('flex gap-2.5', isOwn ? 'flex-row-reverse' : 'flex-row')}>
              {comment.author && (
                <Avatar name={comment.author.name} color={comment.author.avatar_color} size="sm" avatarUrl={comment.author.avatar_url} />
              )}
              <div className={cn('max-w-[80%]', isOwn ? 'items-end' : 'items-start', 'flex flex-col gap-0.5')}>
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  {!isOwn && (
                    <span className="text-xs font-semibold text-[#aaa]">{comment.author?.name}</span>
                  )}
                  {!activeTask && taskLabels[comment.task_id] && (
                    <span className="text-[10px] text-[#444]">{taskLabels[comment.task_id]}</span>
                  )}
                  <span className="text-[10px] text-[#444]">{relativeTime(comment.created_at)}</span>
                </div>
                <div className={cn(
                  'px-3 py-2 rounded-xl text-sm leading-relaxed',
                  isOwn
                    ? 'bg-[#ff3c00]/20 border border-[#ff3c00]/20 text-[#ffcfc6]'
                    : 'bg-[#1e1e1e] border border-[#2a2a2a] text-[#ccc]'
                )}>
                  {renderBody(comment.body)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {activeTask ? (
        <div className="border-t border-[#242424] p-3 shrink-0 relative">
          {/* Mention dropdown */}
          {mentionQuery !== null && mentionOptions.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-1 bg-[#1e1e1e] border border-[#333] rounded-lg overflow-hidden shadow-xl z-10">
              {mentionOptions.slice(0, 5).map(u => (
                <button
                  key={u.id}
                  onMouseDown={e => { e.preventDefault(); insertMention(u) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#2a2a2a] text-left transition-colors"
                >
                  <Avatar name={u.name} color={u.avatar_color} size="sm" avatarUrl={u.avatar_url} />
                  <span className="text-sm text-white">@{u.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={body}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={`Comment on "${activeTask.label}"… (Enter to send)`}
              rows={2}
              className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-sm text-white placeholder-[#444] focus:outline-none focus:ring-1 focus:ring-[#ff3c00] resize-none leading-relaxed"
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || !body.trim()}
              className="p-2 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-40 text-white rounded-lg transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-[#242424] px-4 py-3 shrink-0">
          <p className="text-xs text-[#444] text-center">Click a task to add a comment</p>
        </div>
      )}
    </div>
  )
}

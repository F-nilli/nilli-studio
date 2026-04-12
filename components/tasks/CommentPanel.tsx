'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { X, Send, ArrowUpDown, Lock } from 'lucide-react'
import { InfoIcon } from '@/components/ui/InfoIcon'
import { createClient } from '@/lib/supabase/client'
import { Comment, User, Task, Track, canAccessSettings } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { TRACK_COLORS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { isYesterday, format } from 'date-fns'


type Tab = 'all' | 'tasks' | 'internal'

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
  tasks: Task[]
  currentUser: User
  allUsers: User[]
  activeTask: Task | null
  hasUnread: (taskId: string) => boolean
  onClearFilter: () => void
  onNewComment: (comment: Comment) => void
  onReplaceComment: (tempId: string, real: Comment) => void
  onRemoveComment: (id: string) => void
  highlightCommentId?: string
}

export function CommentPanel({
  episodeId,
  episodeClientKey,
  episodeGuestName,
  episodeClientLabel,
  allComments,
  tasks,
  currentUser,
  allUsers,
  activeTask,
  hasUnread,
  onClearFilter,
  onNewComment,
  onReplaceComment,
  onRemoveComment,
  highlightCommentId,
}: Props) {
  const supabase = createClient()
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [flashedCommentId, setFlashedCommentId] = useState<string | null>(null)
  const commentRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const highlightApplied = useRef(false)
  const [sortDesc, setSortDesc] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)

  const canInternal = canAccessSettings(currentUser)

  // Derived
  const taskLabels = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, t.label])), [tasks])
  const taskTracks = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, t.track as Track])), [tasks])

  const sorted = (list: Comment[]) =>
    [...list].sort((a, b) =>
      sortDesc
        ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        : new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

  const allNonInternal = useMemo(() => sorted(allComments.filter(c => !c.internal)), [allComments, sortDesc])
  const taskOnlyComments = useMemo(() =>
    activeTask ? sorted(allComments.filter(c => c.task_id === activeTask.id && !c.internal)) : [],
    [allComments, activeTask, sortDesc])
  const internalComments = useMemo(() => sorted(allComments.filter(c => c.internal)), [allComments, sortDesc])

  const visibleComments =
    activeTab === 'all' ? allNonInternal :
    activeTab === 'tasks' ? taskOnlyComments :
    internalComments

  const totalUnreadTasks = tasks.filter(t => hasUnread(t.id)).length

  // Auto-switch to TASKS tab when a task is selected
  useEffect(() => {
    if (activeTask) setActiveTab('tasks')
  }, [activeTask?.id])

  // Close TASKS tab if task deselected while on it
  useEffect(() => {
    if (!activeTask && activeTab === 'tasks') setActiveTab('all')
  }, [activeTask])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [visibleComments.length])

  // Close sort menu on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSortMenu(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // Clear error after 4 seconds
  useEffect(() => {
    if (!submitError) return
    const t = setTimeout(() => setSubmitError(null), 4000)
    return () => clearTimeout(t)
  }, [submitError])

  // Scroll to and flash highlighted comment
  useEffect(() => {
    if (!highlightCommentId || highlightApplied.current) return
    const el = commentRefs.current[highlightCommentId]
    if (!el) return
    highlightApplied.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashedCommentId(highlightCommentId)
    setTimeout(() => setFlashedCommentId(null), 2000)
  }, [highlightCommentId, allComments.length])

  // @mention options
  const mentionOptions = mentionQuery !== null
    ? allUsers.filter(u => u.id !== currentUser.id && u.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : []

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    if (val.length > 500) return
    setBody(val)
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

  function insertMention(user: User) {
    const before = body.slice(0, mentionStart)
    const after = body.slice(inputRef.current?.selectionStart ?? body.length)
    setBody(`${before}@${user.name} ${after}`)
    setMentionQuery(null)
    inputRef.current?.focus()
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

  async function handleSubmit() {
    const isInternal = activeTab === 'internal'
    const trimmedBody = body.trim()
    if (!trimmedBody) return
    if (!isInternal && !activeTask) return

    // Clear input immediately for optimistic feel
    setBody('')
    setMentionQuery(null)
    setSubmitError(null)
    setSubmitting(true)

    // Optimistic comment
    const tempId = `optimistic-${Date.now()}`
    const optimisticComment: Comment = {
      id: tempId,
      task_id: activeTask?.id ?? null,
      episode_id: episodeId,
      author_id: currentUser.id,
      body: trimmedBody,
      internal: isInternal,
      created_at: new Date().toISOString(),
      author: currentUser,
    }
    onNewComment(optimisticComment)

    const insertData: Record<string, unknown> = {
      author_id: currentUser.id,
      body: trimmedBody,
      internal: isInternal,
      episode_id: episodeId,
    }
    if (activeTask) insertData.task_id = activeTask.id

    const { data, error } = await supabase
      .from('comments')
      .insert(insertData)
      .select('*, author:users(*)')
      .single()

    if (error || !data) {
      console.error('Comment insert failed:', error)
      // Rollback optimistic comment and restore body
      onRemoveComment(tempId)
      setBody(trimmedBody)
      setSubmitError(error?.message ?? 'Failed to send. Please try again.')
      setSubmitting(false)
      return
    }

    const newComment = data as unknown as Comment
    // Replace optimistic with real comment
    onReplaceComment(tempId, newComment)

    // Notifications (non-blocking, server-side)
    if (activeTask && !isInternal) {
      fetch('/api/notifications/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentId: newComment.id,
          authorId: currentUser.id,
          taskId: activeTask.id,
          episodeId,
          body: trimmedBody,
          assigneeId: activeTask.assignee_id ?? null,
        }),
      }).catch(() => {})

      fetch('/api/slack/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'comment',
          episodeId,
          taskLabel: activeTask.label,
          authorName: currentUser.name,
          commentBody: trimmedBody,
          clientKey: episodeClientKey,
        }),
      }).catch(() => {})
    }

    setSubmitting(false)
  }

  const inputDisabled = activeTab === 'all'
  const inputPlaceholder =
    activeTab === 'internal'
      ? 'Internal note — only visible to admins and managers'
      : activeTask
        ? `Comment on "${activeTask.label}"…`
        : 'Select a task to comment'

  return (
    <div className="flex flex-col bg-[#181818] rounded-xl overflow-hidden" style={{ height: 'calc(100vh - 8rem)', border: '1px solid rgba(255,255,255,0.09)' }}>
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#555] uppercase tracking-widest">Comments</span>
          {totalUnreadTasks > 0 && (
            <span className="min-w-[18px] h-[18px] rounded-full bg-[#f7931a] text-black text-[9px] font-bold flex items-center justify-center px-1">
              {totalUnreadTasks}
            </span>
          )}
        </div>
        <div className="relative" ref={sortRef}>
          <button
            onClick={() => setShowSortMenu(s => !s)}
            className="p-1.5 rounded hover:bg-[#1e1e1e] text-[#444] hover:text-white transition-colors"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
          {showSortMenu && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg overflow-hidden shadow-xl z-20">
              <button
                onClick={() => { setSortDesc(false); setShowSortMenu(false) }}
                className={cn('w-full text-left px-3 py-2 text-xs transition-colors', !sortDesc ? 'text-[#ff3c00]' : 'text-[#888] hover:text-white')}
              >
                Oldest first
              </button>
              <button
                onClick={() => { setSortDesc(true); setShowSortMenu(false) }}
                className={cn('w-full text-left px-3 py-2 text-xs transition-colors', sortDesc ? 'text-[#ff3c00]' : 'text-[#888] hover:text-white')}
              >
                Newest first
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <TabBtn active={activeTab === 'all'} onClick={() => setActiveTab('all')} dot={totalUnreadTasks > 0}>
          All
        </TabBtn>
        {activeTask && (
          <TabBtn active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')}>
            Task
          </TabBtn>
        )}
        {canInternal && (
          <TabBtn active={activeTab === 'internal'} onClick={() => setActiveTab('internal')} isInternal>
            <span className="flex items-center gap-1.5">
              Internal
              <InfoIcon text="Internal notes are only visible to admins and managers. Editors and other team members cannot see this tab or its contents. Internal comments never trigger Slack notifications." />
            </span>
          </TabBtn>
        )}
      </div>

      {/* Task context row (TASKS tab) */}
      {activeTab === 'tasks' && activeTask && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[#222] border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <span className="text-xs text-[#888] truncate flex-1">{activeTask.label}</span>
          <button
            onClick={() => { onClearFilter(); setActiveTab('all') }}
            className="p-1 text-[#555] hover:text-white transition-colors shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {visibleComments.length === 0 && (
          <p className="text-center text-xs text-[#444] py-10">
            {activeTab === 'all' ? 'No comments yet.' :
             activeTab === 'tasks' ? 'No comments on this task yet.' :
             'No internal notes yet.'}
          </p>
        )}

        {visibleComments.map(comment => {
          const isOwn = comment.author_id === currentUser.id
          const isOptimistic = comment.id.startsWith('optimistic-')
          const taskLabel = comment.task_id ? taskLabels[comment.task_id] : null
          const taskTrack = comment.task_id ? taskTracks[comment.task_id] : null
          const trackColor = taskTrack ? TRACK_COLORS[taskTrack] : '#888'
          const commentUnread = comment.task_id ? hasUnread(comment.task_id) : false
          const isHandoff = comment.body.startsWith('→ ')

          return (
            <div
              key={comment.id}
              ref={el => { commentRefs.current[comment.id] = el }}
              className={cn(
                'flex gap-2 transition-opacity',
                isOwn ? 'flex-row-reverse' : 'flex-row',
                isOptimistic && 'opacity-60',
                flashedCommentId === comment.id && 'comment-flash'
              )}
            >
              <div className="shrink-0">
                <Avatar
                  name={comment.author?.name ?? '?'}
                  color={comment.author?.avatar_color ?? '#888'}
                  size="sm"
                  avatarUrl={comment.author?.avatar_url ?? null}
                />
              </div>
              <div className={cn('max-w-[84%] flex flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
                {isHandoff && (
                  <span className="text-[10px] text-[#555] mb-0.5">↗ handoff note</span>
                )}
                {/* Task pill (ALL tab only) */}
                {activeTab === 'all' && taskLabel && (
                  <span
                    className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mb-0.5 truncate max-w-full"
                    style={{ backgroundColor: `${trackColor}25`, color: trackColor }}
                  >
                    {taskLabel}
                  </span>
                )}
                <div className={cn('flex items-baseline gap-1.5 flex-wrap', isOwn && 'flex-row-reverse')}>
                  {!isOwn && (
                    <span className="text-[13px] font-semibold text-[#bbb]">{comment.author?.name}</span>
                  )}
                  {comment.internal && (
                    <Lock className="w-2.5 h-2.5 text-purple-400 shrink-0" />
                  )}
                  {commentUnread && !isOwn && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f7931a] shrink-0" />
                  )}
                  <span className="text-[11px] text-white/30">
                    {isOptimistic ? 'sending…' : relativeTime(comment.created_at)}
                  </span>
                </div>
                <div className={cn(
                  'px-3 py-2.5 rounded-xl text-[14px] leading-relaxed',
                  comment.internal
                    ? isOwn
                      ? 'bg-purple-900/25 border border-purple-700/25 text-purple-200'
                      : 'bg-purple-900/15 border border-purple-700/20 text-purple-300'
                    : isOwn
                      ? 'text-[#ffe8d8]'
                      : 'text-[#d0d0d0]'
                )}
                style={!comment.internal ? (isOwn
                  ? { background: '#2d1f0e', border: '1px solid rgba(247,147,26,0.2)', ...(isHandoff ? { borderLeft: `3px solid ${trackColor}` } : {}) }
                  : { background: '#252525', border: '1px solid rgba(255,255,255,0.09)', ...(isHandoff ? { borderLeft: `3px solid ${trackColor}` } : {}) }
                ) : {}}
                >
                  {renderBody(comment.body)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {submitError && (
        <div className="mx-3 mb-2 px-3 py-2 bg-[#ff3c00]/10 border border-[#ff3c00]/30 rounded-lg text-xs text-[#ff9980] shrink-0">
          {submitError}
        </div>
      )}

      {/* Input area */}
      {inputDisabled ? (
        <div className="border-t px-4 py-3 shrink-0" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <p className="text-[13px] text-white/25 text-center">
            Select a task to comment, or switch to Internal
          </p>
        </div>
      ) : (
        <div className="border-t p-4 shrink-0 relative" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          {/* @mention dropdown */}
          {mentionQuery !== null && (
            <div className="absolute bottom-full left-3 right-3 mb-1 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg overflow-hidden shadow-xl z-20">
              {mentionOptions.length > 0
                ? mentionOptions.slice(0, 6).map(u => (
                    <button
                      key={u.id}
                      onMouseDown={e => { e.preventDefault(); insertMention(u) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#252525] text-left transition-colors"
                    >
                      <Avatar name={u.name} color={u.avatar_color} size="sm" avatarUrl={u.avatar_url} />
                      <span className="text-sm text-white">@{u.name}</span>
                    </button>
                  ))
                : (
                  <p className="px-3 py-2.5 text-xs text-[#555]">No members found</p>
                )
              }
            </div>
          )}

          <div className="flex gap-2 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={body}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={inputPlaceholder}
                rows={2}
                className={cn(
                  'w-full px-3 py-2 rounded-lg text-[14px] text-white placeholder-[#555] focus:outline-none resize-none leading-relaxed',
                  activeTab === 'internal'
                    ? 'bg-purple-950/30 border border-purple-800/30'
                    : ''
                )}
                style={activeTab !== 'internal' ? { background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.12)' } : {}}
              />
              {body.length > 400 && (
                <span className={cn(
                  'absolute bottom-1.5 right-2 text-[10px] tabular-nums',
                  body.length > 480 ? 'text-[#ff3c00]' : 'text-[#555]'
                )}>
                  {500 - body.length}
                </span>
              )}
            </div>
            <button
              onClick={handleSubmit}
              disabled={submitting || !body.trim()}
              className={cn(
                'p-2 disabled:opacity-40 text-white rounded-lg transition-colors shrink-0',
                activeTab === 'internal'
                  ? 'bg-purple-700 hover:bg-purple-600'
                  : 'bg-[#ff3c00] hover:bg-[#e63600]'
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({ children, active, onClick, dot, isInternal }: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  dot?: boolean
  isInternal?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold uppercase tracking-[0.06em] transition-colors border-b-2',
        active
          ? isInternal
            ? 'text-purple-400 border-purple-500'
            : 'text-white border-[#ff3c00]'
          : 'text-[#444] border-transparent hover:text-[#777]'
      )}
    >
      {children}
      {dot && !active && <span className="w-1.5 h-1.5 rounded-full bg-[#f7931a]" />}
    </button>
  )
}

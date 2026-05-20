'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { X, Send, ArrowUpDown, Lock, CornerDownLeft, Pencil, Trash2, Link, Paperclip, FileText } from 'lucide-react'
import { InfoIcon } from '@/components/ui/InfoIcon'
import { createClient } from '@/lib/supabase/client'
import { Comment, CommentAttachment, User, Task, Track, canAccessSettings } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { TRACK_COLORS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { isYesterday, format } from 'date-fns'

const REACTION_EMOJIS = ['👍', '✅', '🔥']

type Tab = 'all' | 'tasks' | 'internal'
type Reaction = { emoji: string; user_id: string }

const ACCEPTED_ATTACH_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const ATTACH_MAX_MB = 10

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

// Renders comment body: markdown links [text](url), @mentions, bare URLs
function renderBody(body: string): React.ReactNode[] {
  const regex = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(@\w+)|(https?:\/\/[^\s<>"]+)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${lastIndex}`}>{body.slice(lastIndex, match.index)}</span>)
    }
    if (match[1]) {
      // Markdown link [text](url)
      parts.push(
        <a
          key={`ml-${match.index}`}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#f7931a] underline underline-offset-2 hover:text-[#e07d10] transition-colors"
          onClick={e => e.stopPropagation()}
        >
          {match[2]}
        </a>
      )
    } else if (match[4]) {
      // @mention
      parts.push(<span key={`m-${match.index}`} className="text-[#f7931a] font-medium">{match[4]}</span>)
    } else if (match[5]) {
      // Bare URL
      const url = match[5]
      parts.push(
        <a
          key={`u-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#f7931a] underline underline-offset-2 hover:text-[#e07d10] transition-colors break-all"
          onClick={e => e.stopPropagation()}
        >
          {url}
        </a>
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < body.length) {
    parts.push(<span key={`t-end`}>{body.slice(lastIndex)}</span>)
  }
  return parts.length > 0 ? parts : [<span key="empty">{body}</span>]
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
  onEditComment: (id: string, newBody: string) => void
  highlightCommentId?: string
  replyToCommentId?: string | null
  onReplyConsumed?: () => void
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
  onEditComment,
  highlightCommentId,
  replyToCommentId,
  onReplyConsumed,
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
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null)
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)

  // Edit / delete state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  // Reactions state: commentId → list of { emoji, user_id }
  const [reactionsMap, setReactionsMap] = useState<Record<string, Reaction[]>>({})

  // ─── Link toolbar state ───────────────────────────────────────────────────────
  const [isFocused, setIsFocused] = useState(false)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [savedSelection, setSavedSelection] = useState<{ start: number; end: number } | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  // ─── File attachment state ────────────────────────────────────────────────────
  const [attachFiles, setAttachFiles] = useState<File[]>([])
  const [attachWarning, setAttachWarning] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canInternal = canAccessSettings(currentUser)

  // Derived
  const taskLabels = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, t.label])), [tasks])
  const taskTracks = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, t.track as Track])), [tasks])

  // Load reactions whenever comment list changes
  useEffect(() => {
    if (allComments.length === 0) return
    const ids = allComments.map(c => c.id).filter(id => !id.startsWith('optimistic-'))
    if (ids.length === 0) return
    supabase
      .from('comment_reactions')
      .select('comment_id, emoji, user_id')
      .in('comment_id', ids)
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, Reaction[]> = {}
        for (const r of data) {
          if (!map[r.comment_id]) map[r.comment_id] = []
          map[r.comment_id].push({ emoji: r.emoji, user_id: r.user_id })
        }
        setReactionsMap(map)
      })
  }, [allComments.length])

  function toggleReaction(commentId: string, emoji: string) {
    const reactions = reactionsMap[commentId] ?? []
    const isMine = reactions.some(r => r.emoji === emoji && r.user_id === currentUser.id)
    setReactionsMap(prev => ({
      ...prev,
      [commentId]: isMine
        ? reactions.filter(r => !(r.emoji === emoji && r.user_id === currentUser.id))
        : [...reactions, { emoji, user_id: currentUser.id }],
    }))
    fetch(`/api/comments/${commentId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    }).catch(() => {
      setReactionsMap(prev => ({ ...prev, [commentId]: reactions }))
    })
  }

  function startEdit(comment: Comment) {
    setEditingCommentId(comment.id)
    setEditDraft(comment.body)
  }

  function cancelEdit() {
    setEditingCommentId(null)
    setEditDraft('')
  }

  async function saveEdit(commentId: string) {
    const trimmed = editDraft.trim()
    if (!trimmed) return
    const original = allComments.find(c => c.id === commentId)?.body ?? ''
    onEditComment(commentId, trimmed)
    setEditingCommentId(null)
    setEditDraft('')
    const res = await fetch(`/api/comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: trimmed }),
    })
    if (!res.ok) onEditComment(commentId, original)
  }

  async function deleteComment(commentId: string) {
    onRemoveComment(commentId)
    await fetch(`/api/comments/${commentId}`, { method: 'DELETE' }).catch(console.error)
  }

  // ─── Link toolbar helpers ─────────────────────────────────────────────────────

  function onLinkButtonMouseDown(e: React.MouseEvent) {
    e.preventDefault() // prevent textarea blur
    const textarea = inputRef.current
    if (!textarea) return
    setSavedSelection({ start: textarea.selectionStart, end: textarea.selectionEnd })
    setShowLinkInput(true)
    setTimeout(() => linkInputRef.current?.focus(), 30)
  }

  function handleLinkInsert() {
    const textarea = inputRef.current
    if (!textarea) return
    let url = linkUrl.trim()
    if (!url) { setShowLinkInput(false); setLinkUrl(''); return }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url

    const sel = savedSelection ?? { start: textarea.selectionStart, end: textarea.selectionEnd }
    const selectedText = body.slice(sel.start, sel.end)
    const linkMd = selectedText ? `[${selectedText}](${url})` : url
    const newBody = body.slice(0, sel.start) + linkMd + body.slice(sel.end)

    setBody(newBody)
    setShowLinkInput(false)
    setLinkUrl('')
    setSavedSelection(null)
    setTimeout(() => {
      textarea.focus()
      const cursor = sel.start + linkMd.length
      textarea.setSelectionRange(cursor, cursor)
    }, 30)
  }

  function handleLinkKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); handleLinkInsert() }
    if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl(''); setSavedSelection(null); inputRef.current?.focus() }
  }

  // ─── Attachment helpers ───────────────────────────────────────────────────────

  function addAttachFiles(files: File[]) {
    const typed = files.filter(f => ACCEPTED_ATTACH_TYPES.includes(f.type))
    const tooBig = typed.filter(f => f.size > ATTACH_MAX_MB * 1024 * 1024)
    const valid = typed.filter(f => f.size <= ATTACH_MAX_MB * 1024 * 1024)

    if (typed.length < files.length) {
      setAttachWarning('Only JPG, PNG, WebP and PDF files are supported')
      setTimeout(() => setAttachWarning(''), 4000)
    } else if (tooBig.length > 0) {
      setAttachWarning(`${tooBig.length === 1 ? `"${tooBig[0].name}" is` : `${tooBig.length} files are`} too large (max ${ATTACH_MAX_MB}MB)`)
      setTimeout(() => setAttachWarning(''), 4000)
    }

    if (valid.length > 0) setAttachFiles(prev => [...prev, ...valid])
  }

  function removeAttachFile(idx: number) {
    setAttachFiles(prev => prev.filter((_, i) => i !== idx))
  }

  async function uploadAttachments(): Promise<CommentAttachment[]> {
    const results: CommentAttachment[] = []
    for (const file of attachFiles) {
      const path = `${episodeId}/comments/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
      const { error } = await supabase.storage.from('episode-references').upload(path, file)
      if (error) continue
      const { data: urlData } = supabase.storage.from('episode-references').getPublicUrl(path)
      results.push({ url: urlData.publicUrl, filename: file.name, type: file.type, size: file.size })
    }
    return results
  }

  // ─── Build replies map ────────────────────────────────────────────────────────

  const repliesMap = useMemo(() => {
    const map: Record<string, Comment[]> = {}
    for (const c of allComments) {
      if (c.parent_comment_id) {
        if (!map[c.parent_comment_id]) map[c.parent_comment_id] = []
        map[c.parent_comment_id].push(c)
      }
    }
    for (const id in map) {
      map[id].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return map
  }, [allComments])

  const sorted = (list: Comment[]) =>
    [...list].sort((a, b) =>
      sortDesc
        ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        : new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

  const topLevelAll = useMemo(() =>
    sorted(allComments.filter(c => !c.parent_comment_id && !c.internal)),
    [allComments, sortDesc])
  const topLevelTask = useMemo(() =>
    activeTask ? sorted(allComments.filter(c => !c.parent_comment_id && !c.internal && c.task_id === activeTask.id)) : [],
    [allComments, activeTask, sortDesc])
  const topLevelInternal = useMemo(() =>
    sorted(allComments.filter(c => !c.parent_comment_id && c.internal)),
    [allComments, sortDesc])

  const visibleTopLevel =
    activeTab === 'all' ? topLevelAll :
    activeTab === 'tasks' ? topLevelTask :
    topLevelInternal

  const totalVisibleCount = useMemo(() => {
    let count = visibleTopLevel.length
    for (const c of visibleTopLevel) {
      const replies = repliesMap[c.id] ?? []
      count += replies.length
      for (const r of replies) count += (repliesMap[r.id] ?? []).length
    }
    return count
  }, [visibleTopLevel, repliesMap])

  const totalUnreadTasks = tasks.filter(t => hasUnread(t.id)).length

  useEffect(() => { if (activeTask) setActiveTab('tasks') }, [activeTask?.id])
  useEffect(() => { if (!activeTask && activeTab === 'tasks') setActiveTab('all') }, [activeTask])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [totalVisibleCount])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSortMenu(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  useEffect(() => {
    if (!submitError) return
    const t = setTimeout(() => setSubmitError(null), 4000)
    return () => clearTimeout(t)
  }, [submitError])

  useEffect(() => {
    if (!highlightCommentId || highlightApplied.current) return
    const el = commentRefs.current[highlightCommentId]
    if (!el) return
    highlightApplied.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashedCommentId(highlightCommentId)
    setTimeout(() => setFlashedCommentId(null), 2000)
  }, [highlightCommentId, allComments.length])

  useEffect(() => {
    if (!replyToCommentId) return
    const comment = allComments.find(c => c.id === replyToCommentId)
    if (comment) {
      setReplyingTo(comment)
      if (!comment.internal) {
        setActiveTab(comment.task_id ? 'tasks' : 'all')
      } else {
        setActiveTab('internal')
      }
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    onReplyConsumed?.()
  }, [replyToCommentId])

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
    if (e.key === 'Escape') {
      setMentionQuery(null)
      if (replyingTo) setReplyingTo(null)
    }
  }

  function startReply(comment: Comment) {
    setReplyingTo(comment)
    if (comment.internal) {
      setActiveTab('internal')
    } else if (comment.task_id) {
      setActiveTab('tasks')
    }
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function handleSubmit() {
    const isInternal = replyingTo ? replyingTo.internal : activeTab === 'internal'
    const trimmedBody = body.trim()
    if (!trimmedBody && attachFiles.length === 0) return
    if (!replyingTo && !isInternal && !activeTask) return

    const replyParent = replyingTo
    setBody('')
    setMentionQuery(null)
    setSubmitError(null)
    setSubmitting(true)
    setReplyingTo(null)

    const taskId = replyParent ? replyParent.task_id : (activeTask?.id ?? null)
    const depth = replyParent ? Math.min((replyParent.depth ?? 0) + 1, 2) : 0

    // Upload attachments first
    let attachments: CommentAttachment[] = []
    if (attachFiles.length > 0) {
      setUploadingFiles(true)
      attachments = await uploadAttachments()
      setUploadingFiles(false)
      setAttachFiles([])
    }

    const tempId = `optimistic-${Date.now()}`
    const optimisticComment: Comment = {
      id: tempId,
      task_id: taskId,
      episode_id: episodeId,
      author_id: currentUser.id,
      body: trimmedBody,
      internal: isInternal,
      created_at: new Date().toISOString(),
      author: currentUser,
      parent_comment_id: replyParent?.id ?? null,
      depth,
      attachments: attachments.length > 0 ? attachments : undefined,
    }
    onNewComment(optimisticComment)

    const insertData: Record<string, unknown> = {
      author_id: currentUser.id,
      body: trimmedBody,
      internal: isInternal,
      episode_id: episodeId,
    }
    if (taskId) insertData.task_id = taskId
    if (replyParent) {
      insertData.parent_comment_id = replyParent.id
      insertData.depth = depth
    }
    if (attachments.length > 0) {
      insertData.attachments = attachments
    }

    const { data, error } = await supabase
      .from('comments')
      .insert(insertData)
      .select('*, author:users(*)')
      .single()

    if (error || !data) {
      console.error('Comment insert failed:', error)
      onRemoveComment(tempId)
      setBody(trimmedBody)
      setReplyingTo(replyParent)
      setSubmitError(error?.message ?? 'Failed to send. Please try again.')
      setSubmitting(false)
      return
    }

    const newComment = data as unknown as Comment
    onReplaceComment(tempId, newComment)

    if (taskId && !isInternal) {
      const replyTask = tasks.find(t => t.id === taskId)
      fetch('/api/notifications/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentId: newComment.id,
          authorId: currentUser.id,
          taskId,
          episodeId,
          body: trimmedBody,
          assigneeId: replyTask?.assignee_id ?? null,
          parentAuthorId: replyParent?.author_id ?? null,
        }),
      }).catch(() => {})

      if (!trimmedBody.startsWith('→ ')) {
        fetch('/api/slack/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'comment',
            episodeId,
            taskLabel: replyTask?.label ?? activeTask?.label,
            authorName: currentUser.name,
            commentBody: trimmedBody,
          }),
        }).catch(err => console.error('[Slack]', err))
      }
    }

    setSubmitting(false)
  }

  const inputDisabled = !replyingTo && activeTab === 'all'
  const effectiveInternal = replyingTo ? replyingTo.internal : activeTab === 'internal'
  const inputPlaceholder = replyingTo
    ? `Reply to ${replyingTo.author?.name ?? 'comment'}…`
    : activeTab === 'internal'
      ? 'Internal note — only visible to admins and managers'
      : activeTask
        ? `Comment on "${activeTask.label}"…`
        : 'Select a task to comment'

  // ─── Comment bubble renderer ─────────────────────────────────────────────────

  function renderCommentBubble(comment: Comment, depth: number) {
    const isOwn = comment.author_id === currentUser.id
    const isOptimistic = comment.id.startsWith('optimistic-')
    const taskLabel = comment.task_id ? taskLabels[comment.task_id] : null
    const taskTrack = comment.task_id ? taskTracks[comment.task_id] : null
    const trackColor = taskTrack ? TRACK_COLORS[taskTrack] : '#888'
    const commentUnread = comment.task_id ? hasUnread(comment.task_id) : false
    const isHandoff = comment.body.startsWith('→ ')
    const isHovered = hoveredCommentId === comment.id
    const isEditing = editingCommentId === comment.id
    const canDepthReply = (comment.depth ?? 0) < 2
    const reactions = reactionsMap[comment.id] ?? []
    const attachments = comment.attachments ?? []
    const imageAttachments = attachments.filter(a => a.type.startsWith('image/'))
    const fileAttachments = attachments.filter(a => !a.type.startsWith('image/'))

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
        onMouseEnter={() => setHoveredCommentId(comment.id)}
        onMouseLeave={() => setHoveredCommentId(null)}
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
          {activeTab === 'all' && taskLabel && depth === 0 && (
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mb-0.5 truncate max-w-full"
              style={{ backgroundColor: `${trackColor}25`, color: trackColor }}
            >
              {taskLabel}
            </span>
          )}
          {/* Name + timestamp + edit/delete actions */}
          <div className={cn('flex items-center gap-1.5 flex-wrap', isOwn && 'flex-row-reverse')}>
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
              {isOptimistic ? (uploadingFiles ? 'uploading…' : 'sending…') : relativeTime(comment.created_at)}
            </span>
            {isOwn && !isOptimistic && !isHandoff && isHovered && (
              <div className={cn('flex items-center gap-1', isOwn ? 'mr-1' : 'ml-1')}>
                <button
                  onClick={() => startEdit(comment)}
                  className="p-0.5 text-[#444] hover:text-[#888] transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => deleteComment(comment.id)}
                  className="p-0.5 text-[#444] hover:text-[#ff6644] transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Bubble or inline edit */}
          {isEditing ? (
            <div className="w-full">
              <textarea
                value={editDraft}
                onChange={e => setEditDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(comment.id) }
                  if (e.key === 'Escape') cancelEdit()
                }}
                autoFocus
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 rounded-xl text-[14px] text-white bg-[#2a2a2a] border border-[#f7931a]/40 focus:outline-none resize-none leading-relaxed"
              />
              <div className={cn('flex gap-3 mt-1', isOwn ? 'justify-end' : 'justify-start')}>
                <button onClick={cancelEdit} className="text-[11px] text-[#555] hover:text-[#888] transition-colors">
                  Cancel
                </button>
                <button onClick={() => saveEdit(comment.id)} className="text-[11px] text-[#f7931a] hover:text-[#e07d10] font-semibold transition-colors">
                  Save
                </button>
              </div>
            </div>
          ) : (
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
              {comment.body ? renderBody(comment.body) : null}

              {/* Image attachments */}
              {imageAttachments.length > 0 && (
                <div className={cn('flex flex-wrap gap-1.5', comment.body ? 'mt-2' : '')}>
                  {imageAttachments.map((att, i) => (
                    <a
                      key={i}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="block shrink-0 rounded-lg overflow-hidden"
                      style={{ maxWidth: 180 }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={att.url}
                        alt={att.filename}
                        className="rounded-lg object-cover hover:brightness-110 transition-all"
                        style={{ maxWidth: 180, maxHeight: 140, display: 'block' }}
                      />
                    </a>
                  ))}
                </div>
              )}

              {/* File (PDF) attachments */}
              {fileAttachments.length > 0 && (
                <div className={cn('flex flex-wrap gap-1.5', comment.body || imageAttachments.length > 0 ? 'mt-2' : '')}>
                  {fileAttachments.map((att, i) => (
                    <a
                      key={i}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors"
                      style={{ background: 'rgba(255,60,0,0.08)', border: '1px solid rgba(255,60,0,0.2)', color: '#aaa' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = '#fff'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,60,0,0.4)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = '#aaa'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,60,0,0.2)' }}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: '#ff3c00' }} />
                      <span className="truncate" style={{ maxWidth: 140 }}>{att.filename}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reactions */}
          {!isOptimistic && !isEditing && (
            <div className={cn('flex gap-1 mt-1', isOwn ? 'justify-end' : 'justify-start')}>
              {REACTION_EMOJIS.map(emoji => {
                const count = reactions.filter(r => r.emoji === emoji).length
                const isMine = reactions.some(r => r.emoji === emoji && r.user_id === currentUser.id)
                if (count === 0 && !isHovered) return null
                return (
                  <button
                    key={emoji}
                    onClick={() => toggleReaction(comment.id, emoji)}
                    className={cn(
                      'flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[12px] transition-all select-none',
                      isMine
                        ? 'bg-[#f7931a]/15 border border-[#f7931a]/40 text-[#f7931a]'
                        : 'bg-[#1e1e1e] border border-[#2a2a2a] text-[#555] hover:text-[#aaa] hover:border-[#3a3a3a]'
                    )}
                  >
                    <span>{emoji}</span>
                    {count > 0 && <span className="text-[10px] font-medium ml-0.5">{count}</span>}
                  </button>
                )
              })}
            </div>
          )}

          {/* Reply button */}
          {!isOptimistic && canDepthReply && (
            <button
              onClick={() => startReply(comment)}
              className={cn(
                'flex items-center gap-1 text-[11px] text-[#555] hover:text-[#888] transition-all mt-0.5',
                isHovered ? 'opacity-100' : 'opacity-0'
              )}
            >
              <CornerDownLeft className="w-3 h-3" />
              Reply
            </button>
          )}
        </div>
      </div>
    )
  }

  // ─── Thread renderer ──────────────────────────────────────────────────────────

  function renderThread(comment: Comment, depth: number = 0): React.ReactNode {
    const replies = repliesMap[comment.id] ?? []
    return (
      <div key={comment.id}>
        {renderCommentBubble(comment, depth)}
        {replies.length > 0 && (
          <div className={cn('mt-2 relative', depth === 0 ? 'ml-8 pl-4' : 'ml-4 pl-3')}
            style={{ borderLeft: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex flex-col gap-3">
              {replies.map(reply => renderThread(reply, depth + 1))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-[#181818] rounded-xl overflow-hidden comment-panel-height" style={{ border: '1px solid rgba(247,147,26,0.3)' }}>
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
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {visibleTopLevel.length === 0 && (
          <p className="text-center text-xs text-[#444] py-10">
            {activeTab === 'all' ? 'No comments yet.' :
             activeTab === 'tasks' ? 'No comments on this task yet.' :
             'No internal notes yet.'}
          </p>
        )}
        {visibleTopLevel.map(comment => renderThread(comment, 0))}
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
        <div className="border-t shrink-0 relative" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          {replyingTo && (
            <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)', background: '#1e1e1e' }}>
              <CornerDownLeft className="w-3 h-3 text-[#555] shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] text-[#555]">Replying to </span>
                <span className="text-[10px] text-[#888] font-semibold">{replyingTo.author?.name}</span>
                <span className="text-[10px] text-[#444] ml-1.5 truncate block">
                  {replyingTo.body.length > 60 ? replyingTo.body.slice(0, 60) + '…' : replyingTo.body}
                </span>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="p-1 text-[#555] hover:text-white transition-colors shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="px-4 pt-3 pb-3 relative">
            {/* Mention dropdown */}
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

            {/* ─── Link toolbar ─── */}
            {isFocused && (
              <div className="flex items-center gap-1 mb-2 h-6">
                {showLinkInput ? (
                  <div className="flex items-center gap-1.5 w-full">
                    <input
                      ref={linkInputRef}
                      type="url"
                      value={linkUrl}
                      onChange={e => setLinkUrl(e.target.value)}
                      onKeyDown={handleLinkKeyDown}
                      placeholder="https://…"
                      className="flex-1 px-2.5 py-1 rounded-md text-[13px] text-white placeholder-[#555] focus:outline-none"
                      style={{ background: '#232323', border: '1px solid rgba(247,147,26,0.35)' }}
                    />
                    <button
                      onMouseDown={e => { e.preventDefault(); handleLinkInsert() }}
                      className="px-2.5 py-1 rounded-md text-[12px] font-semibold text-white transition-colors"
                      style={{ background: '#f7931a' }}
                    >
                      Add
                    </button>
                    <button
                      onMouseDown={e => { e.preventDefault(); setShowLinkInput(false); setLinkUrl(''); setSavedSelection(null) }}
                      className="p-1 text-[#555] hover:text-white transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onMouseDown={onLinkButtonMouseDown}
                    title="Insert link (select text first to hyperlink it)"
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-[#555] hover:text-[#aaa] hover:bg-[#222] transition-colors"
                  >
                    <Link className="w-3.5 h-3.5" />
                    <span>Link</span>
                  </button>
                )}
              </div>
            )}

            {/* Attachment warning */}
            {attachWarning && (
              <p className="text-[11px] text-amber-400 mb-1.5">{attachWarning}</p>
            )}

            {/* Pending attachment chips */}
            {attachFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attachFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px]"
                    style={{ background: '#222', border: '1px solid rgba(255,255,255,0.1)', color: '#888' }}
                  >
                    {file.type.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="w-4 h-4 rounded object-cover"
                      />
                    ) : (
                      <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: '#ff3c00' }} />
                    )}
                    <span className="truncate" style={{ maxWidth: 100 }}>{file.name}</span>
                    <button
                      onMouseDown={e => { e.preventDefault(); removeAttachFile(idx) }}
                      className="ml-0.5 text-[#444] hover:text-[#ff3c00] transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea + buttons row */}
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={body}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => {
                    // Delay hiding toolbar so toolbar button clicks can fire first
                    setTimeout(() => setIsFocused(false), 200)
                  }}
                  placeholder={inputPlaceholder}
                  rows={2}
                  className={cn(
                    'w-full px-3 py-2 rounded-lg text-[14px] text-white placeholder-[#555] focus:outline-none resize-none leading-relaxed',
                    effectiveInternal
                      ? 'bg-purple-950/30 border border-purple-800/30'
                      : ''
                  )}
                  style={!effectiveInternal ? { background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.12)' } : {}}
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

              {/* Attach file button */}
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); fileInputRef.current?.click() }}
                title="Attach file (JPG, PNG, WebP, PDF)"
                className={cn(
                  'p-2 rounded-lg transition-colors shrink-0',
                  effectiveInternal
                    ? 'text-purple-400/60 hover:text-purple-300 hover:bg-purple-900/20'
                    : 'text-[#555] hover:text-[#aaa] hover:bg-[#222]'
                )}
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Send button */}
              <button
                onClick={handleSubmit}
                disabled={submitting || uploadingFiles || (!body.trim() && attachFiles.length === 0)}
                className={cn(
                  'p-2 disabled:opacity-40 text-white rounded-lg transition-colors shrink-0',
                  effectiveInternal
                    ? 'bg-purple-700 hover:bg-purple-600'
                    : 'bg-[#ff3c00] hover:bg-[#e63600]'
                )}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files || [])
                if (files.length) addAttachFiles(files)
                e.target.value = ''
              }}
            />
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

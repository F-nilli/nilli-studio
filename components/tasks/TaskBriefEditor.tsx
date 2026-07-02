'use client'

import { useState, useRef } from 'react'
import { Link as LinkIcon, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@/lib/types'

// ─── Renderer ──────────────────────────────────────────────────────────────────
// Parses markdown-style links [text](url) and bare URLs into <a> tags.
// Used both in the brief editor's read view and in the dashboard card.

export function renderBriefBody(text: string): React.ReactNode {
  const regex = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(https?:\/\/[^\s<>"]+)/g
  const lines = text.split('\n')
  return lines.map((line, li) => {
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    regex.lastIndex = 0
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex)
        parts.push(<span key={`t${li}-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>)
      if (match[1]) {
        parts.push(
          <a key={`ml${li}-${match.index}`} href={match[3]} target="_blank" rel="noopener noreferrer"
            className="text-[#f7931a] underline underline-offset-2 hover:text-[#e07d10] transition-colors">
            {match[2]}
          </a>
        )
      } else if (match[4]) {
        parts.push(
          <a key={`u${li}-${match.index}`} href={match[4]} target="_blank" rel="noopener noreferrer"
            className="text-[#f7931a] underline underline-offset-2 hover:text-[#e07d10] transition-colors break-all">
            {match[4]}
          </a>
        )
      }
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < line.length)
      parts.push(<span key={`t${li}-end`}>{line.slice(lastIndex)}</span>)
    return (
      <span key={`line-${li}`}>
        {parts.length > 0 ? parts : line}
        {li < lines.length - 1 ? '\n' : ''}
      </span>
    )
  })
}

// ─── Editor ────────────────────────────────────────────────────────────────────

interface Props {
  taskId: string
  episodeId: string
  initialBrief: string | null
  /** Can write — admin/ops_manager only */
  canEdit: boolean
  currentUser: User
  assigneeId: string | null
  onSaved: (brief: string | null) => void
  /** Compact = smaller padding/font, used inside the episode expandable panel */
  compact?: boolean
}

export function TaskBriefEditor({
  taskId,
  episodeId,
  initialBrief,
  canEdit,
  currentUser,
  assigneeId,
  onSaved,
  compact = false,
}: Props) {
  const supabase = createClient()
  const [brief, setBrief] = useState(initialBrief || '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Link toolbar state
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [savedSel, setSavedSel] = useState<{ start: number; end: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  const isEmpty = !brief.trim()

  async function handleSave() {
    setSaving(true)
    const newBrief = brief.trim() || null
    await supabase.from('tasks').update({ brief: newBrief }).eq('id', taskId)

    // Notify the assignee when someone else adds or updates the brief
    if (newBrief && assigneeId && assigneeId !== currentUser.id) {
      await supabase.from('notifications').insert({
        user_id: assigneeId,
        type: 'task_brief_added',
        title: 'Brief added to your task',
        body: `${currentUser.name} added a brief — check your dashboard`,
        task_id: taskId,
        episode_id: episodeId,
        read: false,
      })
    }

    setSaving(false)
    setSaved(true)
    setEditing(false)
    onSaved(newBrief)
    setTimeout(() => setSaved(false), 2500)
  }

  function onLinkMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    const ta = textareaRef.current
    if (!ta) return
    setSavedSel({ start: ta.selectionStart, end: ta.selectionEnd })
    setShowLinkInput(true)
    setTimeout(() => linkInputRef.current?.focus(), 30)
  }

  function handleLinkInsert() {
    const ta = textareaRef.current
    if (!ta) return
    let url = linkUrl.trim()
    if (!url) { setShowLinkInput(false); setLinkUrl(''); return }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    const sel = savedSel ?? { start: ta.selectionStart, end: ta.selectionEnd }
    const selectedText = brief.slice(sel.start, sel.end)
    const linkMd = selectedText ? `[${selectedText}](${url})` : url
    const newBrief = brief.slice(0, sel.start) + linkMd + brief.slice(sel.end)
    setBrief(newBrief)
    setShowLinkInput(false)
    setLinkUrl('')
    setSavedSel(null)
    setTimeout(() => {
      ta.focus()
      const cursor = sel.start + linkMd.length
      ta.setSelectionRange(cursor, cursor)
    }, 30)
  }

  // ── Edit mode ───────────────────────────────────────────────────────────────
  if (editing && canEdit) {
    return (
      <div
        className="space-y-2"
        onFocus={() => setToolbarVisible(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setToolbarVisible(false)
            setShowLinkInput(false)
            setLinkUrl('')
            setSavedSel(null)
          }
        }}
      >
        {toolbarVisible && (
          <div className="flex items-center gap-1 h-7">
            {showLinkInput ? (
              <div className="flex items-center gap-1.5 w-full">
                <input
                  ref={linkInputRef}
                  type="url"
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); handleLinkInsert() }
                    if (e.key === 'Escape') {
                      setShowLinkInput(false); setLinkUrl(''); setSavedSel(null)
                      textareaRef.current?.focus()
                    }
                  }}
                  placeholder="https://…"
                  className="flex-1 px-2.5 py-1 rounded-md text-[13px] text-white placeholder-[#555] focus:outline-none"
                  style={{ background: '#232323', border: '1px solid rgba(247,147,26,0.35)' }}
                />
                <button
                  onMouseDown={e => { e.preventDefault(); handleLinkInsert() }}
                  className="px-2.5 py-1 rounded-md text-[12px] font-semibold text-white"
                  style={{ background: '#f7931a' }}
                >
                  Add
                </button>
                <button
                  onMouseDown={e => { e.preventDefault(); setShowLinkInput(false); setLinkUrl(''); setSavedSel(null) }}
                  className="p-1 text-[#555] hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onMouseDown={onLinkMouseDown}
                title="Insert link — select text first to hyperlink it"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-[#555] hover:text-[#aaa] hover:bg-[#222] transition-colors"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Link</span>
              </button>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={brief}
          onChange={e => setBrief(e.target.value)}
          autoFocus
          placeholder="Write thumbnail instructions, reference links, style notes…"
          rows={compact ? 4 : 6}
          className="w-full rounded-lg px-3 py-2 resize-none focus:outline-none placeholder-[#444]"
          style={{
            fontSize: compact ? 13 : 14,
            lineHeight: 1.7,
            color: 'rgba(255,255,255,0.85)',
            background: '#2a2a2a',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(247,147,26,0.6)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
        />

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => { setBrief(initialBrief || ''); setEditing(false) }}
            className="px-3 py-1.5 text-sm text-[#888] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary px-4 py-1.5 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
          >
            {saving ? 'Saving…' : 'Save brief'}
          </button>
        </div>
      </div>
    )
  }

  // ── Read / empty mode ───────────────────────────────────────────────────────
  if (isEmpty) {
    if (!canEdit) return null
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-left text-sm text-[#3a3a3a] hover:text-[#555] italic py-2 px-3 rounded-lg border border-dashed border-[#2a2a2a] hover:border-[#3a3a3a] transition-colors"
      >
        Add brief for assignee…
      </button>
    )
  }

  return (
    <div>
      <p
        className="whitespace-pre-wrap"
        style={{
          fontSize: compact ? 12 : 14,
          lineHeight: 1.7,
          color: 'rgba(255,255,255,0.82)',
        }}
      >
        {renderBriefBody(brief)}
      </p>
      <div className="flex items-center gap-3 mt-1.5">
        {saved && <span className="text-xs text-green-400">Saved</span>}
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-[#444] hover:text-[#666] transition-colors"
          >
            Edit brief
          </button>
        )}
      </div>
    </div>
  )
}

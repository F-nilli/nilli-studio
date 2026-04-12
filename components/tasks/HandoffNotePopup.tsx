'use client'

import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import type { User } from '@/lib/types'

interface Props {
  actionLabel: string  // e.g. "Submitting for review"
  sendLabel: string    // e.g. "Submit"
  nextUser: User
  onSkip: () => void
  onSend: (note: string) => void
  onCancel: () => void
}

export function HandoffNotePopup({ actionLabel, sendLabel, nextUser, onSkip, onSend, onCancel }: Props) {
  const [note, setNote] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 40)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onCancel])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(note.trim()) }
  }

  const firstName = nextUser.name.split(' ')[0]
  const remaining = 300 - note.length

  return (
    <div
      ref={containerRef}
      className="rounded-lg p-3 space-y-2.5"
      style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#555]">{actionLabel}</span>
        <div className="flex items-center gap-1.5">
          <Avatar name={nextUser.name} color={nextUser.avatar_color} size="sm" avatarUrl={nextUser.avatar_url} />
          <span className="text-[11px] text-[#888]">
            Next up: <span className="text-white font-medium">{firstName}</span>
          </span>
        </div>
      </div>

      <div className="relative">
        <textarea
          ref={textareaRef}
          value={note}
          onChange={e => { if (e.target.value.length <= 300) setNote(e.target.value) }}
          onKeyDown={handleKeyDown}
          placeholder={`Leave a note for ${firstName}… (optional)`}
          rows={3}
          className="w-full px-2.5 py-2 bg-[#141414] border border-[#2e2e2e] rounded text-xs text-white placeholder-[#444] resize-none focus:outline-none focus:ring-1 focus:ring-[#ff3c00] leading-relaxed"
        />
        {note.length > 200 && (
          <span className={`absolute bottom-2 right-2 text-[10px] pointer-events-none ${remaining < 20 ? 'text-[#ff3c00]' : 'text-[#555]'}`}>
            {remaining}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onSkip}
          className="px-3 py-1.5 text-xs text-[#666] hover:text-[#aaa] border border-[#2e2e2e] hover:border-[#444] rounded transition-colors"
        >
          Skip
        </button>
        <button
          onClick={() => onSend(note.trim())}
          className="ml-auto px-3 py-1.5 bg-[#ff3c00] hover:bg-[#e63600] text-white text-xs font-semibold rounded transition-colors"
        >
          {note.trim() ? `Send & ${sendLabel}` : sendLabel}
        </button>
      </div>
    </div>
  )
}

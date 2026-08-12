'use client'

import { useState } from 'react'
import type { PendingAction } from '@/lib/usePendingActions'

interface Props {
  actions: PendingAction[]
  onUndo: (id: string) => void
  onSilent?: (id: string) => void
}

// One toast. The progress bar is a pure CSS animation whose duration is fixed
// at mount (remaining time until expiry). The old implementation ran an 80ms
// setInterval + setState, re-rendering the whole stack ~12 times per second
// for as long as any toast was visible — expiry is already handled by
// usePendingActions' own timeout, so no JS timer is needed here at all.
function UndoToast({
  action,
  onUndo,
  onSilent,
}: {
  action: PendingAction
  onUndo: (id: string) => void
  onSilent?: (id: string) => void
}) {
  // Fixed once at mount so later re-renders (e.g. another toast appearing)
  // never restart this toast's progress animation.
  const [durationMs] = useState(() => Math.max(0, action.expiresAt - Date.now()))

  return (
    <div
      className="relative flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm text-white pointer-events-auto overflow-hidden"
      style={{
        background: '#1a1a1a',
        border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        minWidth: 280,
      }}
    >
      <div
        className="absolute bottom-0 left-0 h-[2px] bg-[#f7931a]"
        style={{ animation: `undo-toast-progress ${durationMs}ms linear forwards` }}
      />
      <span className="flex-1 truncate text-[#ccc]">{action.label}</span>
      <button
        onClick={() => onUndo(action.id)}
        className="text-[#f7931a] font-semibold hover:text-[#e07d10] transition-colors shrink-0"
        title="Cancel this action"
      >
        Undo
      </button>
      {onSilent && (
        <>
          <span className="text-[#444] shrink-0">·</span>
          <button
            onClick={() => onSilent(action.id)}
            className="text-[#888] font-medium hover:text-white transition-colors shrink-0"
            title="Commit now without notifying anyone"
          >
            Silent
          </button>
        </>
      )}
    </div>
  )
}

export function UndoToastStack({ actions, onUndo, onSilent }: Props) {
  if (actions.length === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      <style>{`@keyframes undo-toast-progress { from { width: 100% } to { width: 0% } }`}</style>
      {actions.map(action => (
        <UndoToast key={action.id} action={action} onUndo={onUndo} onSilent={onSilent} />
      ))}
    </div>
  )
}

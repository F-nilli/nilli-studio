'use client'

import { useEffect, useState } from 'react'
import type { PendingAction } from '@/lib/usePendingActions'

interface Props {
  actions: PendingAction[]
  onUndo: (id: string) => void
}

export function UndoToastStack({ actions, onUndo }: Props) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (actions.length === 0) return
    const interval = setInterval(() => setNow(Date.now()), 80)
    return () => clearInterval(interval)
  }, [actions.length])

  if (actions.length === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      {actions.map(action => {
        const progress = Math.max(0, (action.expiresAt - now) / 5000)
        return (
          <div
            key={action.id}
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
              style={{ width: `${progress * 100}%`, transition: 'width 80ms linear' }}
            />
            <span className="flex-1 truncate text-[#ccc]">{action.label}</span>
            <button
              onClick={() => onUndo(action.id)}
              className="text-[#f7931a] font-semibold hover:text-[#e07d10] transition-colors shrink-0"
            >
              Undo
            </button>
          </div>
        )
      })}
    </div>
  )
}

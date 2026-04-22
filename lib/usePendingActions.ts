import { useState, useRef, useEffect } from 'react'

export interface PendingAction {
  id: string
  label: string
  expiresAt: number
}

interface PendingEntry extends PendingAction {
  revert: () => void
  commit: () => Promise<void>
  timer: ReturnType<typeof setTimeout>
}

export function usePendingActions() {
  const [visible, setVisible] = useState<PendingAction[]>([])
  const entriesRef = useRef<Map<string, PendingEntry>>(new Map())

  function addPending(label: string, revert: () => void, commit: () => Promise<void>): string {
    const id = Math.random().toString(36).slice(2, 9)
    const expiresAt = Date.now() + 5000

    const timer = setTimeout(async () => {
      entriesRef.current.delete(id)
      setVisible(prev => prev.filter(a => a.id !== id))
      await commit().catch(console.error)
    }, 5000)

    entriesRef.current.set(id, { id, label, expiresAt, revert, commit, timer })
    setVisible(prev => [...prev, { id, label, expiresAt }])
    return id
  }

  function undoPending(id: string) {
    const entry = entriesRef.current.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    entriesRef.current.delete(id)
    setVisible(prev => prev.filter(a => a.id !== id))
    entry.revert()
  }

  // Auto-commit all pending on unmount (page navigation)
  useEffect(() => {
    return () => {
      const entries = Array.from(entriesRef.current.values())
      for (const entry of entries) {
        clearTimeout(entry.timer)
        entry.commit().catch(console.error)
      }
      entriesRef.current.clear()
    }
  }, [])

  return { pendingActions: visible, addPending, undoPending }
}

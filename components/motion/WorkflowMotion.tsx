'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Animate measured layout changes, never mount or unchanged refreshes. */
export function ResizeMotion({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = outer.current!, content = inner.current!
    let previous = content.getBoundingClientRect().height
    let animation: Animation | undefined
    const observer = new ResizeObserver(() => {
      const next = content.getBoundingClientRect().height
      if (Math.abs(next - previous) < 1) return
      const from = animation?.playState === 'running' ? box.getBoundingClientRect().height : previous
      animation?.cancel()
      if (!reduced()) animation = box.animate([
        { height: `${from}px`, overflow: 'clip' },
        { height: `${next}px`, overflow: 'clip' },
      ], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' })
      previous = next
    })
    observer.observe(content)
    return () => { observer.disconnect(); animation?.cancel() }
  }, [])
  return <div ref={outer}><div ref={inner} className="flow-root">{children}</div></div>
}

/** Closing visuals are inert; dismissal handlers still execute immediately. */
export function PanelPresence({ open, children }: { open: boolean; children: ReactNode }) {
  const [visible, setVisible] = useState(open)
  useEffect(() => {
    if (open) { setVisible(true); return }
    const timer = setTimeout(() => setVisible(false), reduced() ? 0 : 200)
    return () => clearTimeout(timer)
  }, [open])
  if (!open && !visible) return null
  return <div className="motion-presence" data-open={open} inert={!open} aria-hidden={!open}>{children}</div>
}

/** Moves one decorative pill; existing buttons retain their handlers and semantics. */
export function SlidingTabs({ value, children }: { value: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const host = ref.current!, indicator = pill.current!
    const measure = () => {
      const button = host.querySelector<HTMLElement>('[data-motion-active="true"]')
      if (!button) return
      indicator.style.transform = `translate(${button.offsetLeft}px, ${button.offsetTop}px)`
      indicator.style.width = `${button.offsetWidth}px`
      indicator.style.height = `${button.offsetHeight}px`
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    host.querySelectorAll('button').forEach(button => observer.observe(button))
    return () => observer.disconnect()
  }, [value])
  return <div ref={ref} className="motion-tabs flex flex-wrap items-center gap-2"><span ref={pill} className="motion-tab-pill" aria-hidden="true" />{children}</div>
}

export function CountMotion({ count, children, className = "inline-flex", style }: { count: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null)
  const previous = useRef(count)
  useEffect(() => {
    const increased = count > previous.current
    previous.current = count
    if (!increased || reduced()) return
    const animation = ref.current?.animate([
      { transform: 'translate(-2px, 2px) scale(.8)' },
      { transform: 'translate(0, 0) scale(1.12)', offset: .65 },
      { transform: 'translate(0, 0) scale(1)' },
    ], { duration: 220, easing: 'ease-out' })
    return () => animation?.cancel()
  }, [count])
  return <span ref={ref} className={className} style={{ ...style, visibility: count > 0 ? undefined : "hidden" }}>{children}</span>
}

export function SaveGlyph({ busy, success }: { busy: boolean; success: boolean }) {
  return <span className="save-glyph" data-busy={busy} data-success={!busy && success} aria-hidden="true">
    <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" /><path d="m5.5 10 3 3 6-6" /></svg>
  </span>
}

/** Stays mounted when the existing task modal closes optimistically. */
export function SaveFeedback() {
  const [entries, setEntries] = useState<Record<string, string>>({})
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const listener = (event: Event) => {
      const { id, state } = (event as CustomEvent<{ id: string; state: string }>).detail
      clearTimeout(timers.get(id))
      setEntries(previous => ({ ...previous, [id]: state }))
      timers.set(id, setTimeout(() => {
        setEntries(previous => { const next = { ...previous }; delete next[id]; return next })
        timers.delete(id)
      }, state === 'saving' ? 30000 : state === 'saved' ? 1800 : 0))
    }
    window.addEventListener('nilli-save-motion', listener)
    return () => { window.removeEventListener('nilli-save-motion', listener); timers.forEach(clearTimeout) }
  }, [])
  const busy = Object.values(entries).includes('saving')
  const success = Object.values(entries).includes('saved')
  return <div className="fixed bottom-20 right-5 z-[100] pointer-events-none" role="status" aria-live="polite">
    {(busy || success) && <span className="inline-flex items-center rounded-lg border border-white/10 bg-[#222] px-3 py-2 text-xs text-white shadow-lg">
      <SaveGlyph busy={busy} success={success} />{busy ? 'Saving…' : 'Saved'}
    </span>}
  </div>
}

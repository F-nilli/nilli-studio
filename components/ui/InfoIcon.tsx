'use client'

import { useState, useRef } from 'react'

export function InfoIcon({ text, maxWidth = 240 }: { text: string; maxWidth?: number }) {
  const [show, setShow] = useState(false)
  const [entering, setEntering] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, above: true })
  const [hovered, setHovered] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const iconRef = useRef<HTMLSpanElement>(null)

  function handleEnter() {
    setHovered(true)
    timerRef.current = setTimeout(() => {
      if (!iconRef.current) return
      const rect = iconRef.current.getBoundingClientRect()
      const above = rect.top > 80
      setPos({ top: rect.top, left: rect.left + rect.width / 2, above })
      setShow(true)
      requestAnimationFrame(() => setEntering(true))
    }, 300)
  }

  function handleLeave() {
    setHovered(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    setShow(false)
    setEntering(false)
  }

  return (
    <>
      <span
        ref={iconRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className="inline-flex items-center justify-center rounded-full cursor-pointer shrink-0 select-none"
        style={{
          width: 14,
          height: 14,
          color: hovered ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)',
          transition: 'color 150ms',
          verticalAlign: 'middle',
        }}
        aria-label="More information"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6.5" stroke="currentColor" strokeWidth="1" />
          <text x="7" y="10.8" textAnchor="middle" fontSize="7.5" fill="currentColor" fontFamily="system-ui, sans-serif" fontWeight="600">i</text>
        </svg>
      </span>
      {show && (
        <span
          style={{
            display: 'block',
            position: 'fixed',
            top: pos.above ? pos.top - 8 : pos.top + 22,
            left: pos.left,
            transform: pos.above ? 'translate(-50%, -100%)' : 'translateX(-50%)',
            zIndex: 9999,
            background: '#2a2a2a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            color: 'rgba(255,255,255,0.85)',
            maxWidth,
            lineHeight: 1.5,
            pointerEvents: 'none',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            opacity: entering ? 1 : 0,
            transition: 'opacity 150ms ease',
          }}
        >
          {text}
        </span>
      )}
    </>
  )
}

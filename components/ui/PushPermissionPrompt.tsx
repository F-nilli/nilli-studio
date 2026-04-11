'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'

export function PushPermissionPrompt() {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    if (Notification.permission !== 'default') return
    const key = 'push-prompt-dismissed'
    if (localStorage.getItem(key)) return

    // Show after a short delay so it doesn't pop up instantly on load
    const t = setTimeout(() => setVisible(true), 4000)
    return () => clearTimeout(t)
  }, [])

  async function handleEnable() {
    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      await subscribeUser()
    }
    dismiss()
  }

  function dismiss() {
    setDismissed(true)
    setVisible(false)
    localStorage.setItem('push-prompt-dismissed', '1')
  }

  async function subscribeUser() {
    try {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (existing) {
        await saveSubscription(existing)
        return
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as unknown as ArrayBuffer,
      })
      await saveSubscription(sub)
    } catch {
      // Subscription failed, silently ignore
    }
  }

  async function saveSubscription(sub: PushSubscription) {
    const json = sub.toJSON()
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      }),
    })
  }

  if (!visible || dismissed) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-start gap-3 rounded-xl border border-white/10 bg-[#1a1a1a] p-4 shadow-2xl"
      style={{ maxWidth: 320, animation: 'slideUp 0.3s ease-out' }}
    >
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#f7931a]/10">
        <Bell size={16} className="text-[#f7931a]" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-white">Enable notifications</p>
        <p className="mt-0.5 text-xs text-white/50">Get notified when tasks are assigned or need your review.</p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleEnable}
            className="rounded-lg bg-[#f7931a] px-3 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90"
          >
            Enable
          </button>
          <button
            onClick={dismiss}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white"
          >
            Not now
          </button>
        </div>
      </div>
      <button onClick={dismiss} className="text-white/30 hover:text-white/60">
        <X size={14} />
      </button>
    </div>
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

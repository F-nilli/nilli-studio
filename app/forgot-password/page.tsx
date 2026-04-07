'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Image src="/logo.png" alt="Nilli Studio" width={140} height={50} className="h-12 w-auto object-contain" priority />
        </div>

        <div className="bg-[#141414] rounded-xl border border-[#2e2e2e] p-6">
          {sent ? (
            <div className="text-center space-y-3">
              <p className="text-white font-medium">Check your email</p>
              <p className="text-sm text-[#888]">
                We sent a password reset link to <span className="text-[#ccc]">{email}</span>.
              </p>
              <p className="text-xs text-[#555]">Didn&apos;t get it? Check your spam folder.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <p className="text-sm text-[#888] mb-4">Enter your email and we&apos;ll send you a reset link.</p>
                {error && (
                  <div className="bg-[#ff3c00]/10 border border-[#ff3c00]/30 text-[#ff3c00] px-3 py-2 rounded-lg text-sm mb-4">
                    {error}
                  </div>
                )}
                <label className="block text-sm font-medium text-[#ccc] mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] focus:border-transparent placeholder-[#555]"
                  placeholder="you@nillistudio.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-[#555] mt-4">
          <Link href="/login" className="text-[#ff3c00] hover:text-[#e63600]">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Image src="/logo.png" alt="Nilli Studio" width={140} height={50} className="h-12 w-auto object-contain" priority />
        </div>

        <form onSubmit={handleLogin} className="bg-[#141414] rounded-xl border border-[#2e2e2e] p-6 space-y-4">
          {error && (
            <div className="bg-[#ff3c00]/10 border border-[#ff3c00]/30 text-[#ff3c00] px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[#ccc] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] focus:border-transparent placeholder-[#555]"
              placeholder="you@nillistudio.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#ccc] mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-[#555] mt-4">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-[#ff3c00] hover:text-[#e63600]">Sign up</Link>
        </p>
      </div>
    </div>
  )
}

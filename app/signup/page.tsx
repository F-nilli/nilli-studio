'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { TEAM_MEMBERS } from '@/lib/constants'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Auto-fill name when email matches a team member
  function handleEmailChange(val: string) {
    setEmail(val)
    const member = TEAM_MEMBERS.find(m => m.email.toLowerCase() === val.toLowerCase())
    if (member) setName(member.name)
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const member = TEAM_MEMBERS.find(m => m.email.toLowerCase() === email.toLowerCase())
    const avatarColor = member?.color || '#fbbf24'
    const role = member?.role || 'member'

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, avatar_color: avatarColor, role },
      },
    })

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

        <form onSubmit={handleSignup} className="bg-[#141414] rounded-xl border border-[#2e2e2e] p-6 space-y-4">
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
              onChange={e => handleEmailChange(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] focus:border-transparent placeholder-[#555]"
              placeholder="you@nillistudio.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#ccc] mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] focus:border-transparent placeholder-[#555]"
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#ccc] mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#2e2e2e] text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff3c00] focus:border-transparent"
              placeholder="Min 6 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-[#ff3c00] hover:bg-[#e63600] disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-[#555] mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-[#ff3c00] hover:text-[#e63600]">Sign in</Link>
        </p>
      </div>
    </div>
  )
}

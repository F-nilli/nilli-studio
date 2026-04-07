'use client'

import { createContext, useContext } from 'react'
import type { User } from '@/lib/types'

interface UserContextValue {
  user: User
  setUser: (user: User) => void
}

export const UserContext = createContext<UserContextValue | null>(null)

export function useCurrentUser(): UserContextValue {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useCurrentUser must be used within a UserContext.Provider')
  return ctx
}

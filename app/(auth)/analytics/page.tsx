import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AnalyticsClient } from './AnalyticsClient'
import type { User } from '@/lib/types'
import { canAccessAnalytics } from '@/lib/types'

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single()
  const currentUser = profile as User

  if (!canAccessAnalytics(currentUser)) redirect('/dashboard')

  return <AnalyticsClient currentUser={currentUser} />
}

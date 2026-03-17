import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NewEpisodeClient } from './NewEpisodeClient'
import type { User } from '@/lib/types'

export default async function NewEpisodePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  const { data: allUsers } = await supabase.from('users').select('*')

  return <NewEpisodeClient currentUser={profile as User} allUsers={(allUsers || []) as User[]} />
}

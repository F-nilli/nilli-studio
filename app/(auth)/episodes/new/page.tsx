import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NewEpisodeClient } from './NewEpisodeClient'
import type { User, Client, DbTaskTemplate } from '@/lib/types'
import { canCreateProject } from '@/lib/types'

export default async function NewEpisodePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || !canCreateProject(profile)) redirect('/dashboard')

  const [usersRes, clientsRes, templatesRes] = await Promise.all([
    supabase.from('users').select('*'),
    supabase.from('clients').select('*').eq('active', true).order('label'),
    supabase.from('task_templates').select('*, assignee:users!assignee_id(*), approver:users!approver_id(*)').order('seq_id'),
  ])

  return (
    <NewEpisodeClient
      currentUser={profile as User}
      allUsers={(usersRes.data || []) as User[]}
      clients={(clientsRes.data || []) as Client[]}
      templates={(templatesRes.data || []) as unknown as DbTaskTemplate[]}
    />
  )
}

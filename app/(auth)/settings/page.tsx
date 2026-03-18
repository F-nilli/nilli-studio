import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SettingsClient } from './SettingsClient'
import type { User, Client, DbTaskTemplate, ActivityEntry, Episode } from '@/lib/types'
import { canAccessSettings } from '@/lib/types'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single()
  if (!profile || !canAccessSettings(profile)) redirect('/dashboard')

  const [usersRes, clientsRes, templatesRes, activityRes, episodesRes] = await Promise.all([
    supabase.from('users').select('*').order('name'),
    supabase.from('clients').select('*').order('label'),
    supabase.from('task_templates').select('*, assignee:users(*)').order('seq_id'),
    supabase
      .from('activity_log')
      .select('*, episode:episodes(guest_name, client_label)')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('episodes').select('*').order('release_date', { ascending: false }),
  ])

  // Active task count per user
  const { data: activeTasks } = await supabase
    .from('tasks')
    .select('assignee_id')
    .in('status', ['ready', 'in_progress', 'in_review', 'revision'])

  const taskCountByUser: Record<string, number> = {}
  for (const t of activeTasks || []) {
    taskCountByUser[t.assignee_id] = (taskCountByUser[t.assignee_id] || 0) + 1
  }

  return (
    <SettingsClient
      currentUser={profile as User}
      allUsers={(usersRes.data || []) as User[]}
      taskCountByUser={taskCountByUser}
      clients={(clientsRes.data || []) as Client[]}
      templates={(templatesRes.data || []) as unknown as DbTaskTemplate[]}
      activity={(activityRes.data || []) as unknown as ActivityEntry[]}
      episodes={(episodesRes.data || []) as Episode[]}
    />
  )
}

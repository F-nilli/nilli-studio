import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Lightweight endpoint — returns only task counts, not full task data.
// Used by the dashboard poll to decide whether a full router.refresh() is needed.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  const isOpsManager = profile?.role === 'ops_manager'

  const [myTasksRes, reviewRes] = await Promise.all([
    // Active tasks assigned to me (excluding done/approved/in_review handed off)
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assignee_id', user.id)
      .in('status', ['in_progress', 'revision', 'locked']),

    // Tasks needing my approval
    isAdmin
      ? supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'in_review')
          .eq('requires_approval', true)
          .neq('assignee_id', user.id)
      : isOpsManager
      ? supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'in_review')
          .eq('requires_approval', true)
          .neq('assignee_id', user.id)
          .eq('approver_id', user.id)
      : Promise.resolve({ count: 0 }),
  ])

  return NextResponse.json({
    myTasksCount: myTasksRes.count ?? 0,
    reviewCount: reviewRes.count ?? 0,
  })
}

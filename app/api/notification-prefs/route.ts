import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('workspace_settings')
    .select('inapp_notifications')
    .limit(1)

  const row = rows?.[0] as { inapp_notifications?: Record<string, boolean> } | null ?? null
  return NextResponse.json(
    { inappNotifications: row?.inapp_notifications ?? {} },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEpisode } from '@/lib/deliver'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { episodeId, silent } = await req.json()
  if (!episodeId) return NextResponse.json({ error: 'Missing episodeId' }, { status: 400 })

  const admin = createAdminClient()

  const { data: deliverer } = await admin.from('users').select('id, role').eq('id', user.id).single()
  if (!deliverer || !['admin', 'ops_manager'].includes(deliverer.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await deliverEpisode(admin, {
    episodeId,
    deliveredBy: user.id,
    silent: Boolean(silent),
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Deliver failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, completedAt: result.completedAt, alreadyDelivered: result.alreadyDelivered })
}

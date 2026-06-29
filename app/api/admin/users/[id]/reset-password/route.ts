import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: target } = await admin.from('users').select('email').eq('id', id).single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Point the reset link at whatever domain this request actually came in on,
  // instead of relying on Supabase's dashboard "Site URL" fallback (which can
  // be a stale localhost value left over from local development).
  const { error } = await admin.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${req.nextUrl.origin}/reset-password`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId, title, body, url, tag } = await req.json()
  if (!userId || !title) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  await sendPushToUser(userId, { title, body, url, tag })
  return NextResponse.json({ ok: true })
}

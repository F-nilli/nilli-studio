import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_EMOJIS = ['👍', '✅', '🔥']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { emoji } = await req.json()
  if (!VALID_EMOJIS.includes(emoji)) return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 })

  const { data: existing } = await supabase
    .from('comment_reactions')
    .select('id')
    .eq('comment_id', id)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .single()

  if (existing) {
    await supabase.from('comment_reactions').delete().eq('id', existing.id)
    return NextResponse.json({ action: 'removed' })
  }

  await supabase.from('comment_reactions').insert({ comment_id: id, user_id: user.id, emoji })
  return NextResponse.json({ action: 'added' })
}

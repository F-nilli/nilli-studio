import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, name, username, role, avatarColor, password } = await req.json()
  const admin = createAdminClient()

  // Check for duplicate username
  const { data: existingUsername } = await admin.from('users').select('id').eq('username', username).maybeSingle()
  if (existingUsername) return NextResponse.json({ error: 'This username is already taken.' }, { status: 400 })

  // Create auth account with provided password
  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authError || !authUser.user) {
    const msg = authError?.message?.includes('already registered')
      ? 'An account with this email already exists.'
      : (authError?.message ?? 'Failed to create account. Please try again.')
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // A database trigger (on_auth_user_created) already inserted a default
  // profile row the instant createUser() above wrote to auth.users — so we
  // update that row with the admin-chosen values instead of inserting a
  // second row, which would always collide on the primary key.
  const { error: profileError } = await admin
    .from('users')
    .update({
      email,
      name,
      username,
      role,
      avatar_color: avatarColor,
      password_changed: false,
    })
    .eq('id', authUser.user.id)
  if (profileError) {
    // Roll back the auth user so we don't leave orphans
    await admin.auth.admin.deleteUser(authUser.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}

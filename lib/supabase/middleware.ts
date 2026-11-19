import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Defense in depth: API routes handle their own authentication (session
  // checks returning 401 JSON, Bearer API keys on /api/v1, CRON_SECRET on
  // cron routes). Never redirect them to /login — the matcher already
  // excludes /api, keep this guard in case the matcher is broadened later.
  if (pathname.startsWith('/api/')) {
    return supabaseResponse
  }

  // Pages that don't require authentication
  const publicPaths = ['/login', '/forgot-password', '/reset-password']
  const isPublicPath = publicPaths.some(p => pathname.startsWith(p))

  // Not logged in → send to login
  if (!user && !isPublicPath && pathname !== '/set-password') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Protect the sponsorship screen itself, in addition to API authorization.
  if (user && pathname === '/creator-portal/sponsorship-admin.html') {
    const {data: profile} = await supabase.from('users').select('role,active').eq('id',user.id).single()
    if(profile?.role !== 'admin' || profile.active !== true) return new NextResponse('Admin access required.', {status:403})
  }

  // Logged in + on a public page → send to dashboard
  if (user && isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Logged in → check if they've set their password yet
  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('password_changed, active')
      .eq('id', user.id)
      .single()

    // Deactivated users lose access immediately: sign them out (revoking their
    // refresh tokens) and send them to login, where the Auth ban set by
    // /api/admin/users/[id]/active stops them signing back in.
    if (profile?.active === false) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      const redirect = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach(c => redirect.cookies.set(c))
      request.cookies.getAll()
        .filter(c => c.name.startsWith('sb-'))
        .forEach(c => redirect.cookies.delete(c.name))
      return redirect
    }

    const passwordChanged = profile?.password_changed ?? true

    if (!passwordChanged && pathname !== '/set-password') {
      // Force to password setup before anything else
      const url = request.nextUrl.clone()
      url.pathname = '/set-password'
      return NextResponse.redirect(url)
    }

    if (passwordChanged && pathname === '/set-password') {
      // Already set — send to dashboard
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

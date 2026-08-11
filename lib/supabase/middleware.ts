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
      .select('password_changed')
      .eq('id', user.id)
      .single()

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

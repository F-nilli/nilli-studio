import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Skip: static assets AND /api routes.
    // API routes authenticate themselves — session routes return 401 JSON,
    // /api/v1 uses Bearer API keys, cron routes use CRON_SECRET. Routing them
    // through this middleware redirected all of those to /login instead.
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

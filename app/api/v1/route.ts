import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey } from '@/lib/apiKeys'

export const dynamic = 'force-dynamic'

// GET /api/v1 — lightweight self-description + a way to check a key works.
export async function GET(req: NextRequest) {
  const apiKey = await validateApiKey(req)
  if (!apiKey) return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 })

  return NextResponse.json({
    ok: true,
    authenticated_as: apiKey.name,
    version: 'v1',
    access: 'read-only',
    endpoints: {
      'GET /api/v1/episodes': 'List episodes. Query params: client_key, archived, limit, offset',
      'GET /api/v1/episodes/:id': 'Get one episode plus its tasks',
    },
  })
}

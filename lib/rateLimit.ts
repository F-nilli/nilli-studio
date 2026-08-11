// Best-effort in-memory rate limiter.
//
// Scope note: on serverless platforms each instance has its own memory, so
// limits are per-instance and reset on cold start. That's the right
// cost/complexity tradeoff at our scale — it stops abuse bursts, scripts
// gone wild, and accidental stampedes. If hard global limits are ever
// needed, swap this for Upstash Redis with the same call signature.

const buckets = new Map<string, { count: number; resetAt: number }>()

// Periodically drop expired buckets so the map doesn't grow forever on
// long-lived instances.
const SWEEP_INTERVAL = 10 * 60_000
let lastSweep = Date.now()

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL) return
  lastSweep = now
  for (const [key, entry] of buckets) {
    if (now > entry.resetAt) buckets.delete(key)
  }
}

/**
 * Fixed-window rate limit check.
 * @param key      unique bucket key, e.g. `v1:${apiKeyId}` or `notif:${userId}`
 * @param limit    max requests allowed per window
 * @param windowMs window size in milliseconds (default 60s)
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  sweep(now)

  const entry = buckets.get(key)
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  entry.count++
  if (entry.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

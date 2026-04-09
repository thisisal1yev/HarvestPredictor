/**
 * Simple in-memory sliding-window rate limiter.
 * Keyed by `userId:routeKey`. Fine for MVP (single-node).
 * Lazily clears stale entries on each check.
 */
type Entry = { hits: number[] }

const buckets = new Map<string, Entry>()

let lastSweep = 0
const SWEEP_INTERVAL_MS = 60_000

function sweep(nowMs: number) {
  if (nowMs - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = nowMs
  const cutoff = nowMs - 10 * 60_000 // drop buckets idle for 10+ min
  for (const [k, v] of buckets) {
    const lastHit = v.hits[v.hits.length - 1]
    if (lastHit === undefined || lastHit < cutoff) {
      buckets.delete(k)
    }
  }
}

/**
 * Returns true if the request should be ALLOWED, false if rate-limited.
 *
 * @param key - unique bucket key (e.g. `${userId}:cv:quick-test`)
 * @param limit - max requests per window
 * @param windowSec - window size in seconds
 */
export function check(key: string, limit: number, windowSec: number): boolean {
  const now = Date.now()
  sweep(now)

  const windowMs = windowSec * 1000
  const cutoff = now - windowMs

  const bucket = buckets.get(key) ?? { hits: [] }
  // drop stale hits
  while (bucket.hits.length && (bucket.hits[0] ?? 0) < cutoff) {
    bucket.hits.shift()
  }

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket)
    return false
  }

  bucket.hits.push(now)
  buckets.set(key, bucket)
  return true
}

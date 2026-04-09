import { randomBytes } from 'node:crypto'

/**
 * Per-connection stream nonce, held in Nuxt memory.
 *
 * Issued by `/api/cv/connections/[id]/start` when Nuxt flips the row to active
 * and forwarded to the Python CV service. Python echoes it back on every
 * internal webhook (`/detection`, `/connection-status`) so Nuxt can verify the
 * webhook came from the same worker that owns this stream right now.
 *
 * The token dies on Nuxt restart — acceptable since Python is the source of
 * truth for active workers and will re-issue on next start.
 */
const tokens = new Map<string, string>()

export function issueToken(connectionId: string): string {
  const token = randomBytes(24).toString('hex')
  tokens.set(connectionId, token)
  return token
}

export function validateToken(connectionId: string, token: string): boolean {
  if (!token) return false
  const expected = tokens.get(connectionId)
  if (!expected) return false
  // Length mismatch short-circuits before the constant-time comparison.
  if (expected.length !== token.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  }
  return diff === 0
}

export function clearToken(connectionId: string): void {
  tokens.delete(connectionId)
}

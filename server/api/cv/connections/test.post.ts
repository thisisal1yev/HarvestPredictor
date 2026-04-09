import { check as rateCheck } from '~~/server/utils/rateLimit'
import { validateStreamUrl } from '~~/server/utils/ssrfGuard'

type TestBody = {
  protocol?: string
  streamUrl?: string
  username?: string | null
  password?: string | null
}

/**
 * Test a stream URL before the user saves a Connection.
 * Rate limited 5/min/user (spec §2.3).
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  if (!rateCheck(`${userId}:cv:conn-test`, 5, 60)) {
    throw createError({ statusCode: 429, statusMessage: 'Test rate limit reached. Try again in a minute.' })
  }

  const body = await readBody<TestBody>(event)
  const streamUrl = body.streamUrl?.trim()
  if (!streamUrl) throw createError({ statusCode: 400, statusMessage: 'streamUrl is required' })

  const guard = await validateStreamUrl(streamUrl)
  if (!guard.ok) {
    return { ok: false, message: guard.message ?? 'Invalid streamUrl' }
  }

  try {
    const res = await cvFetch<{ ok: boolean, message?: string }>('/connections/test', {
      method: 'POST',
      body: {
        protocol: body.protocol,
        streamUrl,
        username: body.username ?? null,
        password: body.password ?? null,
        resolvedIp: guard.resolvedIp
      }
    })
    return { ok: !!res?.ok, message: res?.message ?? (res?.ok ? 'Connection successful' : 'Connection failed') }
  } catch (err: unknown) {
    const e = err as { statusMessage?: string, message?: string }
    return { ok: false, message: e.statusMessage ?? e.message ?? 'Connection failed' }
  }
})

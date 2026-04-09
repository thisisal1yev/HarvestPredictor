import { issueToken, clearToken } from '~~/server/utils/streamTokens'

type LockedRow = {
  id: string
  userId: string
  modelId: string
  protocol: string
  streamUrl: string
  usernameEnc: string | null
  passwordEnc: string | null
}

/**
 * Start a Connection worker.
 *
 *  1. Optimistic lock: flip `idle → active` in a single UPDATE, 409 otherwise.
 *  2. Issue an in-memory stream token.
 *  3. Ask Python to start the worker.
 *  4. If Python 429s or fails, roll the row back to idle.
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const locked = await prisma.$queryRaw<LockedRow[]>`
    UPDATE "Connection"
       SET "status" = 'active',
           "updatedAt" = NOW(),
           "errorMessage" = NULL,
           "reconnectAttempt" = 0
     WHERE "id" = ${id}
       AND "userId" = ${userId}
       AND "status" = 'idle'
    RETURNING "id", "userId", "modelId", "protocol"::text AS "protocol",
              "streamUrl", "usernameEnc", "passwordEnc"
  `

  const row = locked[0]
  if (!row) {
    throw createError({ statusCode: 409, statusMessage: 'Connection is not idle' })
  }

  const streamToken = issueToken(id)

  try {
    await cvFetch('/connections/start', {
      method: 'POST',
      body: {
        connectionId: id,
        userId,
        streamToken,
        protocol: row.protocol,
        streamUrl: row.streamUrl,
        usernameEnc: row.usernameEnc,
        passwordEnc: row.passwordEnc,
        modelId: row.modelId
      }
    })
  } catch (err: unknown) {
    // Roll back: release the lock and drop the token.
    clearToken(id)
    const e = err as { statusCode?: number, statusMessage?: string }
    const errorMessage = e.statusMessage ?? 'Failed to start stream'
    await prisma.connection.update({
      where: { id },
      data: { status: 'idle', errorMessage }
    }).catch(() => { /* already gone */ })

    if (e.statusCode === 429) {
      throw createError({
        statusCode: 429,
        statusMessage: 'Stream limit reached. Stop another connection first.'
      })
    }
    throw createError({ statusCode: e.statusCode ?? 502, statusMessage: errorMessage })
  }

  return { status: 'active', streamToken }
})

import { clearToken } from '~~/server/utils/streamTokens'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  await findOrNotFound(
    prisma.connection.findFirst({ where: { id, userId }, select: { id: true } })
  )

  // Ask Python to shut the worker down; ignore network errors — we still flip
  // the DB row so the user isn't wedged by a cv-service hiccup.
  try {
    await cvFetch('/connections/stop', {
      method: 'POST',
      body: { connectionId: id }
    })
  } catch {
    // best-effort
  }

  await prisma.connection.update({
    where: { id },
    data: { status: 'idle', errorMessage: null, reconnectAttempt: 0 }
  })
  clearToken(id)

  return { status: 'idle' }
})

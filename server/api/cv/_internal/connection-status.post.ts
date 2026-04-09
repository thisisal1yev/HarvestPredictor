import { requireCvApiKey } from '~~/server/utils/cvInternalAuth'
import { clearToken } from '~~/server/utils/streamTokens'
import type { CvConnectionStatus } from '~~/generated/prisma/client'

const VALID: CvConnectionStatus[] = ['idle', 'active', 'disconnected', 'error']

type Body = {
  connectionId?: string
  status?: CvConnectionStatus
  errorMessage?: string | null
  streamToken?: string | null
}

export default defineEventHandler(async (event) => {
  requireCvApiKey(event)
  const body = await readBody<Body>(event)

  if (!body?.connectionId) throw createError({ statusCode: 400, statusMessage: 'connectionId is required' })
  if (!body.status || !VALID.includes(body.status)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid status' })
  }

  try {
    await prisma.connection.update({
      where: { id: body.connectionId },
      data: {
        status: body.status,
        errorMessage: body.errorMessage ?? null
      }
    })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2025') {
      throw createError({ statusCode: 404, statusMessage: 'Connection not found' })
    }
    throw err
  }

  // Any transition out of 'active' drops the stream token.
  if (body.status !== 'active') {
    clearToken(body.connectionId)
  }

  return { ok: true }
})

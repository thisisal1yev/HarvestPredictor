import { requireCvApiKey } from '~~/server/utils/cvInternalAuth'
import type { Prisma } from '~~/generated/prisma/client'

type Body = { activeConnectionIds?: string[] }

/**
 * Startup reconciliation — called by Python right after cv-service starts.
 * Any Connection row that Nuxt thinks is active but Python no longer owns
 * is marked `disconnected` so the UI pushes the user to restart the stream.
 */
export default defineEventHandler(async (event) => {
  requireCvApiKey(event)
  const body = await readBody<Body>(event)
  const activeIds = Array.isArray(body?.activeConnectionIds) ? body.activeConnectionIds : []

  const where: Prisma.ConnectionWhereInput = { status: 'active' }
  if (activeIds.length > 0) {
    where.id = { notIn: activeIds }
  }

  const result = await prisma.connection.updateMany({
    where,
    data: {
      status: 'disconnected',
      errorMessage: 'cv-service restart'
    }
  })

  return { updated: result.count }
})

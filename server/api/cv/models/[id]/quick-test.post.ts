import { check as rateCheck } from '~~/server/utils/rateLimit'

/**
 * Quick Test — ad-hoc one-shot inference, no persistence.
 * Streams the multipart body to Python `/detect/image?modelId=...`.
 * Rate limited 10/min/user (spec §2.2).
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  if (!rateCheck(`${userId}:cv:quick-test`, 10, 60)) {
    throw createError({ statusCode: 429, statusMessage: 'Quick test rate limit reached. Try again in a minute.' })
  }

  // 404 if the model is not owned by the caller.
  await findOrNotFound(
    prisma.cVModel.findFirst({ where: { id, userId }, select: { id: true } })
  )

  return await cvStream('/detect/image', event, {
    modelId: id,
    userId
  })
})

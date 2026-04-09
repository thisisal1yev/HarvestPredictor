import { requireCvApiKey } from '~~/server/utils/cvInternalAuth'

type Body = { id?: string }

export default defineEventHandler(async (event) => {
  requireCvApiKey(event)
  const body = await readBody<Body>(event)
  if (!body?.id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  try {
    await prisma.detection.update({
      where: { id: body.id },
      data: { thumbReady: true }
    })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2025') {
      // Should not happen given the §4.6 ordering (detection row is created
      // before the thumbnail job is enqueued), but log and 404 if it does.
      console.warn('[cv] thumb-ready for missing detection', body.id)
      throw createError({ statusCode: 404, statusMessage: 'Detection not found' })
    }
    throw err
  }

  return { ok: true }
})

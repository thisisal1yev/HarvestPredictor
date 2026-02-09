export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.seasonId || body.predictedYield === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'seasonId and predictedYield are required' })
  }

  const season = await prisma.season.findFirst({
    where: { id: body.seasonId, field: { farm: { userId: session.user.id } } }
  })
  if (!season) {
    throw createError({ statusCode: 404, statusMessage: 'Season not found' })
  }

  return prisma.prediction.create({
    data: {
      predictedYield: body.predictedYield,
      confidence: body.confidence ?? null,
      modelVersion: body.modelVersion || 'mlr-v1',
      seasonId: body.seasonId
    }
  })
})

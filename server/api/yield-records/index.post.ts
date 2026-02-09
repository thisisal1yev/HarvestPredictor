export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.seasonId || body.yieldValue === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'seasonId and yieldValue are required' })
  }

  const season = await prisma.season.findFirst({
    where: { id: body.seasonId, field: { farm: { userId: session.user.id } } }
  })
  if (!season) {
    throw createError({ statusCode: 404, statusMessage: 'Season not found' })
  }

  return prisma.yieldRecord.create({
    data: {
      yieldValue: body.yieldValue,
      unit: body.unit || 't/ha',
      harvestDate: body.harvestDate ? new Date(body.harvestDate) : null,
      seasonId: body.seasonId
    }
  })
})

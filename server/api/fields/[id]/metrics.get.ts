export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const field = await prisma.field.findFirst({
    where: { id, farm: { userId: session.user.id } }
  })
  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  const [sensorReadings, vegetationPoints, yieldRecords, predictions, recommendations, alerts] = await Promise.all([
    prisma.sensorReading.findMany({
      where: { sensorDevice: { fieldId: id } },
      orderBy: { timestamp: 'asc' },
      take: 100
    }),
    prisma.vegetationIndexPoint.findMany({
      where: { droneFlight: { fieldId: id } },
      orderBy: { timestamp: 'asc' },
      take: 100
    }),
    prisma.yieldRecord.findMany({
      where: { season: { fieldId: id } },
      include: { season: { select: { year: true, crop: true } } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.prediction.findMany({
      where: { season: { fieldId: id } },
      include: { season: { select: { year: true, crop: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10
    }),
    prisma.recommendation.findMany({
      where: { fieldId: id },
      orderBy: { createdAt: 'desc' },
      take: 10
    }),
    prisma.alert.findMany({
      where: { fieldId: id, status: 'active' },
      orderBy: { triggeredAt: 'desc' },
      take: 10
    })
  ])

  return { sensorReadings, vegetationPoints, yieldRecords, predictions, recommendations, alerts }
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const device = await prisma.sensorDevice.findFirst({
    where: { id, field: { farm: { userId: session.user.id } } },
    include: { field: { select: { name: true, farm: { select: { name: true } } } }, readings: { orderBy: { timestamp: 'desc' }, take: 50 } }
  })

  if (!device) {
    throw createError({ statusCode: 404, statusMessage: 'Sensor device not found' })
  }

  return device
})

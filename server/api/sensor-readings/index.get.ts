export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const query = getQuery(event)
  const sensorDeviceId = query.sensorDeviceId as string | undefined
  const fieldId = query.fieldId as string | undefined

  return prisma.sensorReading.findMany({
    where: {
      sensorDevice: {
        field: { farm: { userId: session.user.id } },
        ...(fieldId ? { fieldId } : {}),
        ...(sensorDeviceId ? { id: sensorDeviceId } : {})
      }
    },
    include: { sensorDevice: { select: { name: true, type: true } } },
    orderBy: { timestamp: 'desc' },
    take: 200
  })
})

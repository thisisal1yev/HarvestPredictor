export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.sensorDeviceId || !body.timestamp) {
    throw createError({ statusCode: 400, statusMessage: 'sensorDeviceId and timestamp are required' })
  }

  const device = await prisma.sensorDevice.findFirst({
    where: { id: body.sensorDeviceId, field: { farm: { userId: session.user.id } } }
  })
  if (!device) {
    throw createError({ statusCode: 404, statusMessage: 'Sensor device not found' })
  }

  return prisma.sensorReading.create({
    data: {
      timestamp: new Date(body.timestamp),
      moisture: body.moisture ?? null,
      nitrogen: body.nitrogen ?? null,
      phosphorus: body.phosphorus ?? null,
      potassium: body.potassium ?? null,
      temperature: body.temperature ?? null,
      pH: body.pH ?? null,
      sensorDeviceId: body.sensorDeviceId
    }
  })
})

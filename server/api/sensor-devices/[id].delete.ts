export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const device = await prisma.sensorDevice.findFirst({ where: { id, field: { farm: { userId: session.user.id } } } })
  if (!device) {
    throw createError({ statusCode: 404, statusMessage: 'Sensor device not found' })
  }

  await prisma.sensorDevice.delete({ where: { id } })
  return { success: true }
})

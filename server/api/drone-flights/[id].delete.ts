export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const flight = await prisma.droneFlight.findFirst({ where: { id, field: { farm: { userId: session.user.id } } } })
  if (!flight) {
    throw createError({ statusCode: 404, statusMessage: 'Drone flight not found' })
  }

  await prisma.droneFlight.delete({ where: { id } })
  return { success: true }
})

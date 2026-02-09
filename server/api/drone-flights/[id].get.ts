export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const flight = await prisma.droneFlight.findFirst({
    where: { id, field: { farm: { userId: session.user.id } } },
    include: {
      field: { select: { name: true, farm: { select: { name: true } } } },
      vegetationPoints: { orderBy: { timestamp: 'desc' } }
    }
  })

  if (!flight) {
    throw createError({ statusCode: 404, statusMessage: 'Drone flight not found' })
  }

  return flight
})

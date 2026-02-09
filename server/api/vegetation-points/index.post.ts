export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.droneFlightId || body.ndvi === undefined || !body.timestamp) {
    throw createError({ statusCode: 400, statusMessage: 'droneFlightId, ndvi and timestamp are required' })
  }

  const flight = await prisma.droneFlight.findFirst({
    where: { id: body.droneFlightId, field: { farm: { userId: session.user.id } } }
  })
  if (!flight) {
    throw createError({ statusCode: 404, statusMessage: 'Drone flight not found' })
  }

  return prisma.vegetationIndexPoint.create({
    data: {
      timestamp: new Date(body.timestamp),
      ndvi: body.ndvi,
      evi: body.evi ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      droneFlightId: body.droneFlightId
    }
  })
})

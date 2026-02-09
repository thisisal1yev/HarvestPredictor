export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const query = getQuery(event)
  const droneFlightId = query.droneFlightId as string | undefined
  const fieldId = query.fieldId as string | undefined

  return prisma.vegetationIndexPoint.findMany({
    where: {
      droneFlight: {
        field: { farm: { userId: session.user.id } },
        ...(fieldId ? { fieldId } : {}),
        ...(droneFlightId ? { id: droneFlightId } : {})
      }
    },
    include: { droneFlight: { select: { date: true, field: { select: { name: true } } } } },
    orderBy: { timestamp: 'desc' },
    take: 200
  })
})

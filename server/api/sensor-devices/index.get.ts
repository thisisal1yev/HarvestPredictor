export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const query = getQuery(event)
  const fieldId = query.fieldId as string | undefined

  return prisma.sensorDevice.findMany({
    where: {
      field: { farm: { userId: session.user.id } },
      ...(fieldId ? { fieldId } : {})
    },
    include: { _count: { select: { readings: true } }, field: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }
  })
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const query = getQuery(event)
  const seasonId = query.seasonId as string | undefined
  const fieldId = query.fieldId as string | undefined

  return prisma.prediction.findMany({
    where: {
      season: {
        field: { farm: { userId: session.user.id } },
        ...(fieldId ? { fieldId } : {}),
        ...(seasonId ? { id: seasonId } : {})
      }
    },
    include: {
      season: { select: { year: true, crop: true, field: { select: { name: true } } } }
    },
    orderBy: { createdAt: 'desc' }
  })
})

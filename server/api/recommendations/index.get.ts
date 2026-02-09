export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const query = getQuery(event)
  const fieldId = query.fieldId as string | undefined

  return prisma.recommendation.findMany({
    where: {
      field: { farm: { userId: session.user.id } },
      ...(fieldId ? { fieldId } : {})
    },
    include: {
      field: { select: { name: true } },
      season: { select: { year: true, crop: true } }
    },
    orderBy: { createdAt: 'desc' }
  })
})

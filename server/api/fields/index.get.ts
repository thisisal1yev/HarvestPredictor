export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const query = getQuery(event)

  const where: Record<string, unknown> = { farm: { userId: session.user.id } }
  if (query.farmId) {
    where.farmId = query.farmId as string
  }

  return prisma.field.findMany({
    where,
    include: {
      farm: { select: { id: true, name: true } },
      _count: { select: { seasons: true } }
    },
    orderBy: { createdAt: 'desc' }
  })
})

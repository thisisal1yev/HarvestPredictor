export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const query = getQuery(event)

  const where: Record<string, unknown> = { field: { farm: { userId: session.user.id } } }
  if (query.fieldId) {
    where.fieldId = query.fieldId as string
  }

  return prisma.season.findMany({
    where,
    include: {
      field: {
        select: { id: true, name: true, farm: { select: { id: true, name: true } } }
      }
    },
    orderBy: { year: 'desc' }
  })
})

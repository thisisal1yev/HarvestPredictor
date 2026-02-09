export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const query = getQuery(event)
  const fieldId = query.fieldId as string | undefined
  const status = query.status as string | undefined

  return prisma.alert.findMany({
    where: {
      field: { farm: { userId: session.user.id } },
      ...(fieldId ? { fieldId } : {}),
      ...(status ? { status } : {})
    },
    include: { field: { select: { name: true } } },
    orderBy: { triggeredAt: 'desc' }
  })
})

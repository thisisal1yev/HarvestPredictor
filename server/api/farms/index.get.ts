export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  return prisma.farm.findMany({
    where: { userId: session.user.id },
    include: { _count: { select: { fields: true } } },
    orderBy: { createdAt: 'desc' }
  })
})

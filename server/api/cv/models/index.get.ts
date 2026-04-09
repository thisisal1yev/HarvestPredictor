export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  return prisma.cVModel.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' }
  })
})

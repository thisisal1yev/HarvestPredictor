export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  return prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' }
  })
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const rows = await prisma.connection.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      model: { select: { id: true, name: true } },
      field: { select: { id: true, name: true } }
    }
  })
  return rows.map(maskConnection)
})

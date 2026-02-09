export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const record = await prisma.yieldRecord.findFirst({
    where: { id, season: { field: { farm: { userId: session.user.id } } } }
  })
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Yield record not found' })
  }

  await prisma.yieldRecord.delete({ where: { id } })
  return { success: true }
})

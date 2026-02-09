export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const farm = await prisma.farm.findFirst({ where: { id, userId: session.user.id } })
  if (!farm) {
    throw createError({ statusCode: 404, statusMessage: 'Farm not found' })
  }

  await prisma.farm.delete({ where: { id } })
  return { success: true }
})

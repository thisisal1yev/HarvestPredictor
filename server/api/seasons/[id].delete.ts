export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const season = await prisma.season.findFirst({
    where: { id, field: { farm: { userId: session.user.id } } }
  })
  if (!season) {
    throw createError({ statusCode: 404, statusMessage: 'Season not found' })
  }

  await prisma.season.delete({ where: { id } })
  return { success: true }
})

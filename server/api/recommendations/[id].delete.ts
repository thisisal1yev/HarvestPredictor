export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const rec = await prisma.recommendation.findFirst({
    where: { id, field: { farm: { userId: session.user.id } } }
  })
  if (!rec) {
    throw createError({ statusCode: 404, statusMessage: 'Recommendation not found' })
  }

  await prisma.recommendation.delete({ where: { id } })
  return { success: true }
})

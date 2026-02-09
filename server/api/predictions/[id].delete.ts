export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const prediction = await prisma.prediction.findFirst({
    where: { id, season: { field: { farm: { userId: session.user.id } } } }
  })
  if (!prediction) {
    throw createError({ statusCode: 404, statusMessage: 'Prediction not found' })
  }

  await prisma.prediction.delete({ where: { id } })
  return { success: true }
})

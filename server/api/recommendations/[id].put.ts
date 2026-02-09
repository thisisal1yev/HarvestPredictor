export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const rec = await prisma.recommendation.findFirst({
    where: { id, field: { farm: { userId: session.user.id } } }
  })
  if (!rec) {
    throw createError({ statusCode: 404, statusMessage: 'Recommendation not found' })
  }

  return prisma.recommendation.update({
    where: { id },
    data: {
      type: body.type ?? rec.type,
      title: body.title ?? rec.title,
      description: body.description ?? rec.description,
      priority: body.priority ?? rec.priority,
      payload: body.payload ?? rec.payload
    }
  })
})

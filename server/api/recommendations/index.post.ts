export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.fieldId || !body.type || !body.title || !body.description) {
    throw createError({ statusCode: 400, statusMessage: 'fieldId, type, title and description are required' })
  }

  const field = await prisma.field.findFirst({ where: { id: body.fieldId, farm: { userId: session.user.id } } })
  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  return prisma.recommendation.create({
    data: {
      type: body.type,
      title: body.title,
      description: body.description,
      priority: body.priority || 'medium',
      payload: body.payload || null,
      fieldId: body.fieldId,
      seasonId: body.seasonId || null
    }
  })
})

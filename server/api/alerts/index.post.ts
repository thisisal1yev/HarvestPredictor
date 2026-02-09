export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.fieldId || !body.rule || !body.message) {
    throw createError({ statusCode: 400, statusMessage: 'fieldId, rule and message are required' })
  }

  const field = await prisma.field.findFirst({ where: { id: body.fieldId, farm: { userId: session.user.id } } })
  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  return prisma.alert.create({
    data: {
      rule: body.rule,
      message: body.message,
      status: body.status || 'active',
      severity: body.severity || 'warning',
      fieldId: body.fieldId
    }
  })
})

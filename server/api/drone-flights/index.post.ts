export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.fieldId || !body.date) {
    throw createError({ statusCode: 400, statusMessage: 'fieldId and date are required' })
  }

  const field = await prisma.field.findFirst({ where: { id: body.fieldId, farm: { userId: session.user.id } } })
  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  return prisma.droneFlight.create({
    data: {
      date: new Date(body.date),
      altitude: body.altitude ?? null,
      notes: body.notes ?? null,
      fieldId: body.fieldId
    }
  })
})

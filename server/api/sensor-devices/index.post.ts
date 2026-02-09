export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.name || !body.type || !body.fieldId) {
    throw createError({ statusCode: 400, statusMessage: 'Name, type and fieldId are required' })
  }

  const field = await prisma.field.findFirst({ where: { id: body.fieldId, farm: { userId: session.user.id } } })
  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  return prisma.sensorDevice.create({
    data: { name: body.name, type: body.type, fieldId: body.fieldId }
  })
})

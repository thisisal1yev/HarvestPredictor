export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.fieldId || !body.year || !body.crop) {
    throw createError({ statusCode: 400, statusMessage: 'fieldId, year and crop are required' })
  }

  const field = await prisma.field.findFirst({
    where: { id: body.fieldId, farm: { userId: session.user.id } }
  })
  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  return prisma.season.create({
    data: {
      year: parseInt(body.year),
      crop: body.crop,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      notes: body.notes || null,
      fieldId: body.fieldId
    }
  })
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.name || !body.farmId) {
    throw createError({ statusCode: 400, statusMessage: 'Name and farmId are required' })
  }

  const farm = await prisma.farm.findFirst({ where: { id: body.farmId, userId: session.user.id } })
  if (!farm) {
    throw createError({ statusCode: 404, statusMessage: 'Farm not found' })
  }

  return prisma.field.create({
    data: {
      name: body.name,
      area: body.area ? parseFloat(body.area) : null,
      cropType: body.cropType || null,
      farmId: body.farmId
    }
  })
})

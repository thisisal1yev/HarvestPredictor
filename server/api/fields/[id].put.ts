export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const field = await prisma.field.findFirst({ where: { id, farm: { userId: session.user.id } } })
  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  return prisma.field.update({
    where: { id },
    data: {
      name: body.name ?? field.name,
      area: body.area !== undefined ? (body.area ? parseFloat(body.area) : null) : field.area,
      cropType: body.cropType ?? field.cropType
    }
  })
})

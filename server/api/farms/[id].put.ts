export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const farm = await prisma.farm.findFirst({ where: { id, userId: session.user.id } })
  if (!farm) {
    throw createError({ statusCode: 404, statusMessage: 'Farm not found' })
  }

  return prisma.farm.update({
    where: { id },
    data: {
      name: body.name ?? farm.name,
      location: body.location ?? farm.location
    }
  })
})

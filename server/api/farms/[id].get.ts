export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const farm = await prisma.farm.findFirst({
    where: { id, userId: session.user.id },
    include: { fields: { include: { _count: { select: { seasons: true } } } } }
  })

  if (!farm) {
    throw createError({ statusCode: 404, statusMessage: 'Farm not found' })
  }

  return farm
})

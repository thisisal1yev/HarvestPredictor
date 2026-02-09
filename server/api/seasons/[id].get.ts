export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const season = await prisma.season.findFirst({
    where: { id, field: { farm: { userId: session.user.id } } },
    include: {
      field: {
        select: { id: true, name: true, farm: { select: { id: true, name: true } } }
      }
    }
  })

  if (!season) {
    throw createError({ statusCode: 404, statusMessage: 'Season not found' })
  }

  return season
})

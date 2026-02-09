export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const field = await prisma.field.findFirst({
    where: { id, farm: { userId: session.user.id } },
    include: {
      farm: { select: { id: true, name: true } },
      seasons: { orderBy: { year: 'desc' } }
    }
  })

  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  return field
})

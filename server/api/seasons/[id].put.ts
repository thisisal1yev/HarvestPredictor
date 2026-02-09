export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const season = await prisma.season.findFirst({
    where: { id, field: { farm: { userId: session.user.id } } }
  })
  if (!season) {
    throw createError({ statusCode: 404, statusMessage: 'Season not found' })
  }

  return prisma.season.update({
    where: { id },
    data: {
      year: body.year ? parseInt(body.year) : season.year,
      crop: body.crop ?? season.crop,
      startDate: body.startDate !== undefined ? (body.startDate ? new Date(body.startDate) : null) : season.startDate,
      endDate: body.endDate !== undefined ? (body.endDate ? new Date(body.endDate) : null) : season.endDate,
      notes: body.notes ?? season.notes
    }
  })
})

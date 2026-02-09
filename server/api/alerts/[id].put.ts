export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const alert = await prisma.alert.findFirst({
    where: { id, field: { farm: { userId: session.user.id } } }
  })
  if (!alert) {
    throw createError({ statusCode: 404, statusMessage: 'Alert not found' })
  }

  return prisma.alert.update({
    where: { id },
    data: {
      status: body.status ?? alert.status,
      severity: body.severity ?? alert.severity
    }
  })
})

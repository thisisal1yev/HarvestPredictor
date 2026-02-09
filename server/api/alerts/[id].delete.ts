export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const alert = await prisma.alert.findFirst({
    where: { id, field: { farm: { userId: session.user.id } } }
  })
  if (!alert) {
    throw createError({ statusCode: 404, statusMessage: 'Alert not found' })
  }

  await prisma.alert.delete({ where: { id } })
  return { success: true }
})

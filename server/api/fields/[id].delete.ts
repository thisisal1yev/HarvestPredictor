export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')

  const field = await prisma.field.findFirst({ where: { id, farm: { userId: session.user.id } } })
  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  await prisma.field.delete({ where: { id } })
  return { success: true }
})

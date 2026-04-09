export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  return findOrNotFound(
    prisma.cVModel.findFirst({
      where: { id, userId: session.user.id }
    })
  )
})

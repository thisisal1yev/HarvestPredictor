export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const conn = await findOrNotFound(
    prisma.connection.findFirst({
      where: { id, userId: session.user.id },
      include: {
        model: { select: { id: true, name: true } },
        field: { select: { id: true, name: true } }
      }
    })
  )

  return maskConnection(conn)
})

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event)

  if (!body.role || !['admin', 'farmer'].includes(body.role)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid role. Must be "admin" or "farmer".' })
  }

  if (id === session.user.id && body.role !== 'admin') {
    throw createError({ statusCode: 400, statusMessage: 'Cannot remove your own admin role' })
  }

  return prisma.user.update({
    where: { id },
    data: { role: body.role },
    select: { id: true, email: true, name: true, role: true }
  })
})

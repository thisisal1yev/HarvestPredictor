export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readBody(event)

  if (!body.name) {
    throw createError({ statusCode: 400, statusMessage: 'Farm name is required' })
  }

  return prisma.farm.create({
    data: {
      name: body.name,
      location: body.location || null,
      userId: session.user.id
    }
  })
})

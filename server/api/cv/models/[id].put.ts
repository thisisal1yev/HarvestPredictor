export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody<{
    name?: string
    cropType?: string | null
    isDefault?: boolean
  }>(event)

  // 404 if the row doesn't belong to the caller — matches spec §5.
  const current = await findOrNotFound(
    prisma.cVModel.findFirst({ where: { id, userId: session.user.id } })
  )

  const nextCropType: string | null = body.cropType === undefined
    ? current.cropType
    : (body.cropType || null)

  const nextIsDefault = body.isDefault ?? current.isDefault

  // When setting this model as default, clear any other default for the same
  // (userId, cropType) bucket. Partial unique index in DB enforces this too,
  // but doing it in a transaction gives a clean upsert.
  if (nextIsDefault && !current.isDefault) {
    return prisma.$transaction(async (tx) => {
      await tx.cVModel.updateMany({
        where: {
          userId: session.user.id,
          cropType: nextCropType,
          isDefault: true,
          NOT: { id }
        },
        data: { isDefault: false }
      })
      return tx.cVModel.update({
        where: { id },
        data: {
          name: body.name ?? current.name,
          cropType: nextCropType,
          isDefault: true
        }
      })
    })
  }

  return prisma.cVModel.update({
    where: { id },
    data: {
      name: body.name ?? current.name,
      cropType: nextCropType,
      isDefault: nextIsDefault
    }
  })
})

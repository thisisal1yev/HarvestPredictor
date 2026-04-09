export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const d = await findOrNotFound(
    prisma.detection.findFirst({ where: { id, userId }, select: { id: true, snapshotKey: true } })
  )

  if (d.snapshotKey) {
    try {
      await deleteSnapshotPrefix(d.snapshotKey)
    } catch {
      // MinIO lifecycle is a safety net; keep DB deletion deterministic.
    }
  }

  await prisma.detection.delete({ where: { id } })

  setResponseStatus(event, 204)
  return null
})

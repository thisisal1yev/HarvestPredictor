/**
 * Delete a CVModel.
 * - 404 if not owned
 * - 409 if it still has connections (Prisma `Restrict` on Connection.modelId)
 * - On success, also ask the Python CV service to remove the .onnx file
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const model = await findOrNotFound(
    prisma.cVModel.findFirst({ where: { id, userId } })
  )

  try {
    await prisma.cVModel.delete({ where: { id } })
  } catch (err: unknown) {
    const e = err as { code?: string }
    // Prisma `Restrict` error codes: P2003 (FK violation) / P2014 (required relation)
    if (e.code === 'P2003' || e.code === 'P2014') {
      const connectionsCount = await prisma.connection.count({
        where: { modelId: id, userId }
      })
      throw createError({
        statusCode: 409,
        statusMessage: 'Model is in use by one or more connections',
        data: { connectionsCount }
      })
    }
    throw err
  }

  // Fire-and-forget: don't fail the request if the file is already gone.
  try {
    await cvFetch(`/models/${encodeURIComponent(userId)}/${encodeURIComponent(model.filename)}`, {
      method: 'DELETE'
    })
  } catch {
    // Ignore — DB row is already gone, file cleanup is best-effort.
  }

  setResponseStatus(event, 204)
  return null
})

import { clearToken } from '~~/server/utils/streamTokens'

/**
 * Delete a Connection:
 *   1. ask Python to stop the worker (best-effort)
 *   2. scrub MinIO snapshots for every Detection of this connection
 *   3. delete the Connection row (cascade removes detections)
 *   4. clear any stream token
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  await findOrNotFound(
    prisma.connection.findFirst({ where: { id, userId }, select: { id: true } })
  )

  // Best-effort stop — Python may have already lost the worker.
  try {
    await cvFetch('/connections/stop', {
      method: 'POST',
      body: { connectionId: id }
    })
  } catch {
    // Ignore — the row is going away regardless.
  }

  // Fetch every snapshot key attached to this connection and scrub them.
  const detections = await prisma.detection.findMany({
    where: { connectionId: id, userId, snapshotKey: { not: null } },
    select: { snapshotKey: true }
  })

  for (const d of detections) {
    if (!d.snapshotKey) continue
    try {
      await deleteSnapshotPrefix(d.snapshotKey)
    } catch {
      // Ignore — MinIO lifecycle will eventually reap orphans.
    }
  }

  await prisma.connection.delete({ where: { id } })
  clearToken(id)

  setResponseStatus(event, 204)
  return null
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const d = await findOrNotFound(
    prisma.detection.findFirst({
      where: { id, userId },
      include: {
        connection: { select: { id: true, name: true } }
      }
    })
  )

  const fullUrl = d.snapshotKey ? await presignGet(`${d.snapshotKey}/full.jpg`) : null
  const thumbUrl = d.thumbReady && d.snapshotKey
    ? await presignGet(`${d.snapshotKey}/thumb.jpg`)
    : null

  // KnowledgeBase lookup is best-effort: first public match on disease name.
  const treatment = await prisma.knowledgeBase.findFirst({
    where: { diseaseName: d.className }
  }).catch(() => null)

  return {
    id: d.id,
    className: d.className,
    category: d.category,
    confidence: d.confidence,
    severity: d.severity,
    bbox: d.bbox,
    snapshotKey: d.snapshotKey,
    thumbReady: d.thumbReady,
    thumbUrl,
    fullUrl,
    connectionId: d.connectionId,
    connectionName: d.connection?.name ?? null,
    detectedAt: d.detectedAt,
    lastSeenAt: d.lastSeenAt,
    treatment: treatment ?? null
  }
})

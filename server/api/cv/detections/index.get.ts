import type { CvDetectionSeverity, Prisma } from '~~/generated/prisma/client'

const VALID_SEVERITIES: CvDetectionSeverity[] = ['confirmed', 'likely', 'possible']

function parseDate(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  const d = new Date(raw)
  return isNaN(d.getTime()) ? undefined : d
}

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const q = getQuery(event)

  const page = Math.max(1, Number.parseInt(String(q.page ?? '1'), 10) || 1)
  const limitRaw = Number.parseInt(String(q.limit ?? '50'), 10) || 50
  const limit = Math.max(1, Math.min(100, limitRaw))

  const where: Prisma.DetectionWhereInput = { userId }

  if (typeof q.connectionId === 'string' && q.connectionId) {
    where.connectionId = q.connectionId
  }
  if (typeof q.className === 'string' && q.className) {
    where.className = q.className
  }
  if (typeof q.severity === 'string' && VALID_SEVERITIES.includes(q.severity as CvDetectionSeverity)) {
    where.severity = q.severity as CvDetectionSeverity
  }

  const from = parseDate(q.from)
  const to = parseDate(q.to)
  if (from || to) {
    where.detectedAt = {}
    if (from) where.detectedAt.gte = from
    if (to) where.detectedAt.lte = to
  }

  const [total, rows] = await Promise.all([
    prisma.detection.count({ where }),
    prisma.detection.findMany({
      where,
      orderBy: { detectedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        connection: { select: { id: true, name: true } }
      }
    })
  ])

  const items = await Promise.all(
    rows.map(async (d) => {
      const thumbUrl = d.thumbReady && d.snapshotKey
        ? await presignGet(`${d.snapshotKey}/thumb.jpg`)
        : null

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
        connectionId: d.connectionId,
        connectionName: d.connection?.name ?? null,
        detectedAt: d.detectedAt,
        lastSeenAt: d.lastSeenAt
      }
    })
  )

  return { items, total, page, limit }
})

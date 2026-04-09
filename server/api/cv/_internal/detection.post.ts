import { requireCvApiKey } from '~~/server/utils/cvInternalAuth'
import { validateToken } from '~~/server/utils/streamTokens'
import type {
  CvDetectionCategory,
  CvDetectionSeverity,
  Prisma
} from '~~/generated/prisma/client'

type DetectionBody = {
  id?: string
  connectionId?: string
  userId?: string
  className?: string
  category?: CvDetectionCategory
  confidence?: number
  severity?: CvDetectionSeverity
  bbox?: { x: number, y: number, w: number, h: number }
  snapshotKey?: string
  streamToken?: string
}

const DEDUP_WINDOW_SECONDS = 60
const BBOX_ROUND = 0.05 // round to 5% grid — matches Python's "rounded bbox" dedup

type LooseBbox = { x?: number, y?: number, w?: number, h?: number } | null | undefined

function roundBbox(b: LooseBbox): [number, number, number, number] | null {
  if (!b) return null
  return [
    Math.round((b.x ?? 0) / BBOX_ROUND) * BBOX_ROUND,
    Math.round((b.y ?? 0) / BBOX_ROUND) * BBOX_ROUND,
    Math.round((b.w ?? 0) / BBOX_ROUND) * BBOX_ROUND,
    Math.round((b.h ?? 0) / BBOX_ROUND) * BBOX_ROUND
  ]
}

export default defineEventHandler(async (event) => {
  requireCvApiKey(event)

  const body = await readBody<DetectionBody>(event)
  if (!body || !body.id || !body.connectionId || !body.userId || !body.streamToken) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields' })
  }

  if (!validateToken(body.connectionId, body.streamToken)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid stream token' })
  }

  // Connection must exist, belong to the claimed user, and currently be active.
  const conn = await prisma.connection.findFirst({
    where: { id: body.connectionId, userId: body.userId },
    select: { id: true, status: true }
  })
  if (!conn) {
    throw createError({ statusCode: 404, statusMessage: 'Connection not found' })
  }
  if (conn.status !== 'active') {
    throw createError({ statusCode: 409, statusMessage: 'Connection is not active' })
  }

  const rounded = roundBbox(body.bbox)
  if (!rounded) {
    throw createError({ statusCode: 400, statusMessage: 'bbox is required' })
  }

  // Dedup: look for a Detection in the last 60s with the same
  // (connectionId, className, rounded bbox).
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_SECONDS * 1000)
  const candidates = await prisma.detection.findMany({
    where: {
      connectionId: body.connectionId,
      className: body.className,
      detectedAt: { gte: cutoff }
    },
    orderBy: { detectedAt: 'desc' },
    take: 20
  })

  const match = candidates.find((d) => {
    const b = d.bbox as { x?: number, y?: number, w?: number, h?: number } | null
    const r = roundBbox(b ?? undefined)
    if (!r) return false
    return r[0] === rounded[0] && r[1] === rounded[1] && r[2] === rounded[2] && r[3] === rounded[3]
  })

  if (match) {
    await prisma.detection.update({
      where: { id: match.id },
      data: { lastSeenAt: new Date() }
    })
    return { action: 'updated', id: match.id }
  }

  // New Detection — trust the ULID `id` Python already used as the MinIO folder.
  await prisma.detection.create({
    data: {
      id: body.id,
      className: body.className!,
      category: body.category!,
      confidence: body.confidence!,
      severity: body.severity!,
      bbox: body.bbox as unknown as Prisma.InputJsonValue,
      snapshotKey: body.snapshotKey ?? null,
      thumbReady: false,
      connectionId: body.connectionId,
      userId: body.userId
    }
  })

  await prisma.connection.update({
    where: { id: body.connectionId },
    data: { lastDetectionAt: new Date(), lastFrameAt: new Date() }
  })

  return { action: 'created', id: body.id }
})

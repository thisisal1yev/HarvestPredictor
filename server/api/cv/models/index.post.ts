/**
 * Upload ONNX model — streamed multipart.
 *
 * Per spec §5.7 (Code Note A), we do NOT use `readMultipartFormData`
 * (buffers 100 MB into RAM). Instead, the client sends `name` and `cropType`
 * as query params and the file as the raw multipart body, which we stream
 * straight through to the Python CV service.
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const query = getQuery(event)
  const name = typeof query.name === 'string' ? query.name.trim() : ''
  const cropType = typeof query.cropType === 'string' ? query.cropType.trim() : ''

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'name query param is required' })
  }

  const upstream = await cvStream('/models/upload', event, {
    userId,
    name,
    cropType: cropType || undefined
  }) as {
    filename: string
    originalName?: string
    sha256: string
    fileSize: number
    name?: string
    cropType?: string | null
    metadata?: unknown
  }

  if (!upstream || !upstream.filename || !upstream.sha256 || typeof upstream.fileSize !== 'number') {
    throw createError({ statusCode: 502, statusMessage: 'CV service returned invalid upload response' })
  }

  return prisma.cVModel.create({
    data: {
      userId,
      name,
      filename: upstream.filename,
      originalName: upstream.originalName ?? upstream.filename,
      hash: upstream.sha256,
      fileSize: upstream.fileSize,
      cropType: cropType || null,
      metadata: (upstream.metadata ?? undefined) as object | undefined
    }
  })
})

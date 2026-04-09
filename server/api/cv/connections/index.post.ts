import { validateStreamUrl } from '~~/server/utils/ssrfGuard'
import type { CvStreamProtocol } from '~~/generated/prisma/client'

const VALID_PROTOCOLS: CvStreamProtocol[] = ['rtsp', 'rtmp', 'http_mjpeg']

type CreateBody = {
  name?: string
  protocol?: string
  streamUrl?: string
  username?: string | null
  password?: string | null
  modelId?: string
  fieldId?: string | null
}

async function encryptCred(plain: string): Promise<string> {
  const res = await cvFetch<{ ciphertext: string }>('/credentials/encrypt', {
    method: 'POST',
    body: { plaintext: plain }
  })
  if (!res || typeof res.ciphertext !== 'string') {
    throw createError({ statusCode: 502, statusMessage: 'CV service returned invalid encrypt response' })
  }
  return res.ciphertext
}

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const body = await readBody<CreateBody>(event)

  const name = body.name?.trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })

  const protocol = body.protocol as CvStreamProtocol | undefined
  if (!protocol || !VALID_PROTOCOLS.includes(protocol)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid protocol' })
  }

  const streamUrl = body.streamUrl?.trim()
  if (!streamUrl) throw createError({ statusCode: 400, statusMessage: 'streamUrl is required' })

  if (!body.modelId) throw createError({ statusCode: 400, statusMessage: 'modelId is required' })

  // Validate modelId belongs to the user — 404 (spec §5 integrity rule).
  await findOrNotFound(
    prisma.cVModel.findFirst({ where: { id: body.modelId, userId }, select: { id: true } })
  )

  // Validate fieldId belongs to the user (via Farm → User).
  if (body.fieldId) {
    await findOrNotFound(
      prisma.field.findFirst({
        where: { id: body.fieldId, farm: { userId } },
        select: { id: true }
      })
    )
  }

  const guard = await validateStreamUrl(streamUrl)
  if (!guard.ok) {
    throw createError({ statusCode: 400, statusMessage: guard.message ?? 'Invalid streamUrl' })
  }

  let usernameEnc: string | null = null
  let passwordEnc: string | null = null
  if (body.username) usernameEnc = await encryptCred(body.username)
  if (body.password) passwordEnc = await encryptCred(body.password)

  const created = await prisma.connection.create({
    data: {
      name,
      protocol,
      streamUrl,
      usernameEnc,
      passwordEnc,
      modelId: body.modelId,
      userId,
      fieldId: body.fieldId || null
    },
    include: {
      model: { select: { id: true, name: true } },
      field: { select: { id: true, name: true } }
    }
  })

  return maskConnection(created)
})

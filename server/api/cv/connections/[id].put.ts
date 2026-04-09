import { validateStreamUrl } from '~~/server/utils/ssrfGuard'
import type { CvStreamProtocol } from '~~/generated/prisma/client'

const VALID_PROTOCOLS: CvStreamProtocol[] = ['rtsp', 'rtmp', 'http_mjpeg']

type UpdateBody = {
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
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody<UpdateBody>(event)

  const current = await findOrNotFound(
    prisma.connection.findFirst({ where: { id, userId } })
  )

  // Refuse to edit a running connection — user must Stop first so we don't
  // mutate fields that the Python worker is already holding.
  if (current.status === 'active') {
    throw createError({ statusCode: 409, statusMessage: 'Stop the connection before editing it' })
  }

  const data: Record<string, unknown> = {}

  if (body.name !== undefined) {
    if (!body.name.trim()) throw createError({ statusCode: 400, statusMessage: 'name cannot be empty' })
    data.name = body.name.trim()
  }

  if (body.protocol !== undefined) {
    if (!VALID_PROTOCOLS.includes(body.protocol as CvStreamProtocol)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid protocol' })
    }
    data.protocol = body.protocol
  }

  if (body.streamUrl !== undefined) {
    if (!body.streamUrl.trim()) {
      throw createError({ statusCode: 400, statusMessage: 'streamUrl cannot be empty' })
    }
    const guard = await validateStreamUrl(body.streamUrl)
    if (!guard.ok) {
      throw createError({ statusCode: 400, statusMessage: guard.message ?? 'Invalid streamUrl' })
    }
    data.streamUrl = body.streamUrl
  }

  if (body.modelId !== undefined) {
    await findOrNotFound(
      prisma.cVModel.findFirst({ where: { id: body.modelId, userId }, select: { id: true } })
    )
    data.modelId = body.modelId
  }

  if (body.fieldId !== undefined) {
    if (body.fieldId) {
      await findOrNotFound(
        prisma.field.findFirst({
          where: { id: body.fieldId, farm: { userId } },
          select: { id: true }
        })
      )
      data.fieldId = body.fieldId
    } else {
      data.fieldId = null
    }
  }

  // Re-encrypt only if the caller explicitly sends new credential strings.
  // `null` explicitly clears a stored credential.
  if (body.username !== undefined) {
    data.usernameEnc = body.username ? await encryptCred(body.username) : null
  }
  if (body.password !== undefined) {
    data.passwordEnc = body.password ? await encryptCred(body.password) : null
  }

  const updated = await prisma.connection.update({
    where: { id },
    data,
    include: {
      model: { select: { id: true, name: true } },
      field: { select: { id: true, name: true } }
    }
  })

  return maskConnection(updated)
})

import type { H3Event } from 'h3'

type FetchOptions = {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  query?: Record<string, string | number | undefined>
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const cfg = useRuntimeConfig()
  const base = (cfg.cvServiceUrl as string).replace(/\/+$/, '')
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

function mapCvError(status: number, body: unknown): never {
  let message = 'CV service error'
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (typeof b.detail === 'string') message = b.detail
    else if (typeof b.message === 'string') message = b.message
  } else if (typeof body === 'string' && body) {
    message = body
  }

  if (status >= 400 && status < 500) {
    throw createError({ statusCode: status, statusMessage: message })
  }
  throw createError({ statusCode: 502, statusMessage: `CV service unavailable: ${message}` })
}

/**
 * Generic JSON fetch to the Python CV service.
 * Adds the X-API-Key header and maps errors to H3 errors.
 */
export async function cvFetch<T = unknown>(path: string, init: FetchOptions = {}): Promise<T> {
  const cfg = useRuntimeConfig()
  const url = buildUrl(path, init.query)

  try {
    const result = await $fetch(url, {
      method: (init.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
      headers: {
        'X-API-Key': cfg.cvApiKey as string,
        ...(init.headers ?? {})
      },
      body: init.body as Record<string, unknown> | undefined
    })
    return result as T
  } catch (err: unknown) {
    const e = err as { statusCode?: number, status?: number, data?: unknown, message?: string }
    const status = e.statusCode ?? e.status ?? 502
    mapCvError(status, e.data ?? e.message ?? null)
  }
}

/**
 * Streams the incoming request body directly to the Python CV service.
 * Used for large multipart uploads (ONNX files, Quick Test images).
 * Caller must pass only safe, parsed query params — never trust raw body keys.
 */
export async function cvStream(
  path: string,
  event: H3Event,
  query?: Record<string, string | number | undefined>,
  extraHeaders?: Record<string, string>
): Promise<unknown> {
  const cfg = useRuntimeConfig()
  const url = buildUrl(path, query)

  const contentType = getRequestHeader(event, 'content-type') ?? ''
  const contentLength = getRequestHeader(event, 'content-length')

  const headers: Record<string, string> = {
    'X-API-Key': cfg.cvApiKey as string,
    'Content-Type': contentType,
    ...(extraHeaders ?? {})
  }
  if (contentLength) headers['Content-Length'] = contentLength

  const body = getRequestWebStream(event)
  if (!body) {
    throw createError({ statusCode: 400, statusMessage: 'Request body required' })
  }

  // Use native fetch for streaming uploads with duplex: 'half'.
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      // @ts-expect-error — Node 18+ requires duplex for streamed bodies
      duplex: 'half'
    })
  } catch (err: unknown) {
    const e = err as { message?: string }
    throw createError({ statusCode: 502, statusMessage: `CV service unreachable: ${e.message ?? 'network error'}` })
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    mapCvError(res.status, data)
  }
  return data
}

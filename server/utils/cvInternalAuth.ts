import type { H3Event } from 'h3'

/**
 * Guard for `/api/cv/_internal/*` webhook endpoints.
 * Nginx already restricts source IPs to the Docker bridge network; this is
 * a second layer — verifies the shared CV_API_KEY header.
 */
export function requireCvApiKey(event: H3Event): void {
  const cfg = useRuntimeConfig()
  const expected = cfg.cvApiKey as string
  if (!expected) {
    throw createError({ statusCode: 500, statusMessage: 'CV_API_KEY not configured' })
  }
  const provided = getRequestHeader(event, 'x-api-key')
  if (!provided || provided !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid API key' })
  }
}

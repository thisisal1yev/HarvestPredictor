/**
 * Helper: await a Prisma query and throw 404 if the row is null.
 * Used for /[id] routes where we prefer 404 over 403 to prevent ID enumeration
 * (spec §5, "404 for unowned resources to prevent ID enumeration").
 */
export async function findOrNotFound<T>(promise: Promise<T | null>): Promise<T> {
  const row = await promise
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  return row
}

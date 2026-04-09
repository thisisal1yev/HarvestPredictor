/**
 * Mask encrypted credentials before returning a Connection to the client.
 * Never expose the ciphertext — clients only need to know whether creds exist.
 */
type ConnectionLike = {
  usernameEnc?: string | null
  passwordEnc?: string | null
  [key: string]: unknown
}

export function maskConnection<T extends ConnectionLike>(conn: T): T {
  return {
    ...conn,
    usernameEnc: conn.usernameEnc ? '***' : null,
    passwordEnc: conn.passwordEnc ? '***' : null
  }
}

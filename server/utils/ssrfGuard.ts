import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const ALLOWED_SCHEMES = new Set(['rtsp:', 'rtmp:', 'http:', 'https:'])

type GuardResult = { ok: boolean, message?: string, resolvedIp?: string }

function ok(resolvedIp?: string): GuardResult {
  return { ok: true, resolvedIp }
}

function fail(message: string): GuardResult {
  return { ok: false, message }
}

function ipToBigInt(ip: string, family: number): bigint {
  if (family === 4) {
    const parts = ip.split('.').map(n => Number(n))
    const a = parts[0] ?? 0
    const b = parts[1] ?? 0
    const c = parts[2] ?? 0
    const d = parts[3] ?? 0
    return (BigInt(a) << 24n) | (BigInt(b) << 16n) | (BigInt(c) << 8n) | BigInt(d)
  }
  // v6: expand and parse as 128-bit
  const full = expandV6(ip)
  const groups = full.split(':').map(g => parseInt(g, 16))
  let acc = 0n
  for (const g of groups) acc = (acc << 16n) | BigInt(Number.isNaN(g) ? 0 : g)
  return acc
}

function expandV6(ip: string): string {
  // Strip zone id
  const bare = ip.split('%')[0] ?? ip
  // Handle "::"
  if (!bare.includes('::')) {
    const parts = bare.split(':')
    if (parts.length !== 8) return bare
    return parts.map(p => p.padStart(4, '0')).join(':')
  }
  const [head, tail] = bare.split('::')
  const headParts = head ? head.split(':') : []
  const tailParts = tail ? tail.split(':') : []
  const missing = 8 - headParts.length - tailParts.length
  const full = [
    ...headParts,
    ...Array.from({ length: missing }, () => '0'),
    ...tailParts
  ]
  return full.map(p => p.padStart(4, '0')).join(':')
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(n => Number(n))
  const a = parts[0] ?? 0
  const b = parts[1] ?? 0
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  if (a === 0) return true // 0.0.0.0/8
  return false
}

function isPrivateV6(ip: string): boolean {
  const addr = ipToBigInt(ip, 6)
  // ::1 loopback
  if (addr === 1n) return true
  // fc00::/7 unique local
  const fc00Mask = ((1n << 7n) - 1n) << 121n
  const fc00 = 0xfc00n << 112n
  if ((addr & fc00Mask) === fc00) return true
  // fe80::/10 link-local
  const fe80Mask = ((1n << 10n) - 1n) << 118n
  const fe80 = 0xfe80n << 112n
  if ((addr & fe80Mask) === fe80) return true
  // ::ffff:0:0/96 v4-mapped — unwrap and re-check as v4
  const v4MappedMask = ((1n << 96n) - 1n) << 32n
  const v4Mapped = 0xffffn << 32n
  if ((addr & v4MappedMask) === v4Mapped) {
    const v4 = Number(addr & 0xffffffffn)
    const a = (v4 >>> 24) & 0xff
    const b = (v4 >>> 16) & 0xff
    const c = (v4 >>> 8) & 0xff
    const d = v4 & 0xff
    return isPrivateV4(`${a}.${b}.${c}.${d}`)
  }
  return false
}

/**
 * Validate a stream URL before forwarding it to the Python CV service.
 *
 * Denies:
 *   - non-stream schemes (anything outside rtsp/rtmp/http/https)
 *   - hostnames that resolve to RFC1918, loopback, link-local, unique-local
 *
 * Returns { ok: true, resolvedIp } or { ok: false, message }.
 */
export async function validateStreamUrl(rawUrl: string): Promise<GuardResult> {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return fail('streamUrl is required')
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return fail('Invalid stream URL')
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return fail(`Scheme "${parsed.protocol.replace(':', '')}" is not allowed`)
  }

  const host = parsed.hostname
  if (!host) return fail('Stream URL must include a host')

  // Strip brackets from v6
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

  const literalFamily = isIP(bareHost)
  let ip: string
  let family: number

  if (literalFamily) {
    ip = bareHost
    family = literalFamily
  } else {
    try {
      const res = await lookup(bareHost)
      ip = res.address
      family = res.family
    } catch {
      return fail(`Could not resolve host "${bareHost}"`)
    }
  }

  const blocked = family === 6 ? isPrivateV6(ip) : isPrivateV4(ip)
  if (blocked) {
    return fail(`Host "${bareHost}" resolves to a private/loopback address (${ip})`)
  }

  return ok(ip)
}

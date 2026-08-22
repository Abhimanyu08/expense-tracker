/* PBKDF2 via WebCrypto.
 *
 * bcrypt and argon2 are native modules and do not run on Workers, so PBKDF2 is
 * the only real option here. ITERATIONS is deliberately a single knob: the
 * Workers free plan caps CPU per request, and this is the one operation in the
 * app heavy enough to hit that ceiling. Measure a real login with
 * `wrangler tail` before raising it. */
const ITERATIONS = 100_000
const KEY_BITS = 256

const enc = new TextEncoder()

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ITERATIONS)
  return `pbkdf2$sha256$${ITERATIONS}$${b64(salt)}$${b64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, algo, iterStr, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'pbkdf2' || algo !== 'sha256') return false
  const iterations = Number(iterStr)
  if (!Number.isInteger(iterations) || iterations < 1) return false

  // Iterations come from the stored record, not the constant, so raising
  // ITERATIONS later does not lock out existing users.
  const actual = await derive(password, unb64(saltB64), iterations)
  return timingSafeEqual(actual, unb64(hashB64))
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

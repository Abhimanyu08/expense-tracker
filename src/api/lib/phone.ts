/* Phone is the login identifier, so it has to normalise to exactly one string
 * per human. Bare 10-digit input is assumed Indian, which is where the users
 * are; anything else must carry its own country code. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return /^\d{8,15}$/.test(digits) ? `+${digits}` : null
  }
  const digits = trimmed.replace(/\D/g, '')
  if (/^\d{10}$/.test(digits)) return `+91${digits}`
  if (/^91\d{10}$/.test(digits)) return `+${digits}`
  if (/^0\d{10}$/.test(digits)) return `+91${digits.slice(1)}`
  return null
}

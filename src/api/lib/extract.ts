import type { Screenshot } from '../db/schema'

export type ExtractedPayment = {
  amount: number // integer paise
  payee: string | null
  notes: string | null
  paidAt: number // epoch ms, UTC
  uniqueId: string | null
}

/* Three outcomes, and the distinction between the last two is the whole
 * retry policy: 'invalid' means the model answered and the answer is unusable,
 * which no retry fixes at temperature 0.1 -- same pixels, same garbage, more
 * Neurons. Infrastructure failures throw instead, and keep the existing
 * release-and-retry path. */
export type ParseOutcome =
  | { kind: 'payment'; payment: ExtractedPayment }
  | { kind: 'no_payment' }
  | { kind: 'invalid'; reason: string }

/* Asia/Kolkata is UTC+5:30 and has had no DST since 1945, so a constant is
 * correct here and an Intl round-trip would be CPU we cannot spare. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i

// Above this it is a misread, not a meal.
const MAX_AMOUNT_PAISE = 1_000_000_00

/* A real transaction reference is a compact token -- UPI is 12 digits, other
 * providers use alphanumerics. Requiring no spaces is what rejects the classic
 * misread where a weaker model returns "State Bank of India 3704" for this
 * field: a wrong id here is worse than none, because it would dedupe two
 * unrelated payments into one. */
const TXN_ID = /^[A-Za-z0-9_-]{6,64}$/

// The model hallucinates years; anchor the sanity window to the screenshot.
const MAX_FUTURE_MS = 2 * 24 * 60 * 60 * 1000
const MAX_PAST_MS = 365 * 24 * 60 * 60 * 1000

/* The model reports the wall clock printed on the screenshot with no offset --
 * "2026-08-22T15:58:00". `new Date()` on that parses it as LOCAL time, and a
 * Worker's local zone is UTC, so it lands 5h30m in the FUTURE. Measured: a
 * 3:58pm IST receipt becomes 15:58Z instead of 10:28Z. For anything paid
 * between 00:00 and 05:30 IST it also lands on the wrong DAY.
 *
 * Parsing the fields by hand rather than patching the string also dodges two
 * other traps: a date-only string is spec'd as UTC while a date-time is spec'd
 * as local, and Date.UTC silently rolls month 13 into next January. */
export function istToEpochMs(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()

  if (HAS_OFFSET.test(s)) {
    const t = Date.parse(s)
    return Number.isFinite(t) ? t : null
  }

  const m = NAIVE.exec(s)
  if (!m) return null
  const [, y, mo, d, h, mi, sec] = m
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, sec ? +sec : 0)
  if (!Number.isFinite(utc)) return null

  // Round-trip to reject 2026-02-31 and friends, which Date.UTC accepts.
  const back = new Date(utc)
  if (back.getUTCFullYear() !== +y || back.getUTCMonth() !== +mo - 1 || back.getUTCDate() !== +d) {
    return null
  }
  return utc - IST_OFFSET_MS
}

export function toPaise(raw: unknown): number | null {
  let n: number
  if (typeof raw === 'number') {
    n = raw
  } else if (typeof raw === 'string') {
    // guided_json says number, but a drifting model sends "₹1,234.50".
    const cleaned = raw.replace(/[^\d.]/g, '')
    if (!cleaned || (cleaned.match(/\./g)?.length ?? 0) > 1) return null
    n = Number(cleaned)
  } else {
    return null
  }
  if (!Number.isFinite(n) || n <= 0) return null
  // 47.35 * 100 is 4734.999... in binary float, so round before trusting it.
  const paise = Math.round(n * 100)
  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > MAX_AMOUNT_PAISE) return null
  return paise
}

/* Under guided_json a model with nothing to put in a required string field
 * writes the literal "null" or "N/A" rather than omitting the key. */
const EMPTYISH = new Set(['null', 'n/a', 'none', 'unknown', '-', ''])

export function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\s+/g, ' ')
  if (EMPTYISH.has(t.toLowerCase())) return null
  return t.slice(0, max)
}

export function transactionId(raw: unknown): string | null {
  const t = clean(raw, 64)
  return t && TXN_ID.test(t) ? t : null
}

/** amount is the only mandatory field -- everything else degrades to a default. */
export function normalizeExtraction(raw: unknown, shot: Screenshot): ParseOutcome {
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'invalid', reason: 'Model returned no object' }
  }
  const r = raw as Record<string, unknown>

  // Strict ===, not truthy: a string "false" must not read as a payment.
  if (r.is_payment !== true) return { kind: 'no_payment' }

  const amount = toPaise(r.amount)
  if (amount === null) {
    return { kind: 'invalid', reason: `Unusable amount: ${JSON.stringify(r.amount) ?? 'missing'}` }
  }

  /* We ask for currency but do not store it, so this check is the only thing
   * standing between "4700 paise" and a $47 payment recorded as ₹47. */
  const currency = clean(r.currency, 8)
  if (currency && currency.toUpperCase() !== 'INR' && currency !== '₹') {
    return { kind: 'invalid', reason: `Unsupported currency: ${currency}` }
  }

  const t = istToEpochMs(r.datetime)
  const inWindow =
    t !== null && t <= shot.createdAt + MAX_FUTURE_MS && t >= shot.createdAt - MAX_PAST_MS

  return {
    kind: 'payment',
    payment: {
      amount,
      payee: clean(r.payee, 120),
      notes: clean(r.note, 200),
      uniqueId: transactionId(r.transaction_id),
      // A slightly wrong date on a real expense beats discarding the expense.
      paidAt: inWindow ? t : shot.createdAt,
    },
  }
}

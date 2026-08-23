import type { Screenshot } from '../db/schema'

export const PARSE_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'

/* Chosen empirically, not from benchmarks: tested against real production
 * screenshots it was exact on amount, payee, timestamp and the 12-digit UPI
 * transaction ID on every payment, and correctly refused a non-payment. The
 * cheaper Moondream invented a whole transaction from a console-error
 * screenshot, which in an expense tracker is worse than failing loudly. */

/* Keep this prompt and schema byte-for-byte as tested. Asking for fields we do
 * not store -- transaction_id, status, payment_method -- is not waste: it is
 * part of why the model reads the receipt carefully instead of skimming for a
 * number. Ask for nine, persist four. */
const PROMPT = `You are reading a screenshot from an Indian payment app (Google Pay, PhonePe, Paytm, or a bank app).

Extract the transaction and respond with ONLY a JSON object. No prose, no markdown fences.

Use exactly this shape:
{"is_payment":bool,"amount":number|null,"currency":string|null,"payee":string|null,"note":string|null,"datetime":string|null,"status":string|null,"transaction_id":string|null,"payment_method":string|null}

Rules:
- If this is NOT a payment confirmation, return {"is_payment":false} with null for every other field.
- Prefer the full payee name from the details section over a truncated header.
- amount is a number without currency symbols or commas.
- transaction_id is the UPI transaction ID if present.
- datetime in ISO 8601 if you can determine it.`

const SCHEMA = {
  type: 'object',
  properties: {
    is_payment: { type: 'boolean' },
    amount: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'] },
    payee: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
    datetime: { type: ['string', 'null'] },
    status: { type: ['string', 'null'] },
    transaction_id: { type: ['string', 'null'] },
    payment_method: { type: ['string', 'null'] },
  },
  required: ['is_payment'],
}

/* The generated Ai types declare `response` as a string and know nothing about
 * `choices` or `usage.neurons`. Measured, this call returns all three, with
 * `response` already parsed into an object by guided_json. */
type AiRunOutput = {
  response?: unknown
  choices?: Array<{ message?: { content?: string } }>
  usage?: { neurons?: number }
}

/* A CPU-limit kill does not run your catch block -- the isolate dies, the claim
 * is never released, and the row sits 'processing' until the 16-minute sweep,
 * looking like a hang rather than an error. So this is checked against the size
 * already on the row, before a single byte is read from R2.
 *
 * 500 KB measured at 1.91 ms to encode, and the binding then stringifies and
 * UTF-8 encodes the base64 on top of that, so the real cost is several times
 * the encode alone against a 10 ms budget. Raise this only with `wrangler tail`
 * cpuTime numbers in hand. */
export const AI_INLINE_MAX_BYTES = 512 * 1024

/** Thrown when the service, not the screenshot, is the problem. */
export class AiUnavailableError extends Error {
  readonly refundAttempt: boolean
  constructor(message: string, refundAttempt: boolean) {
    super(message)
    this.name = 'AiUnavailableError'
    this.refundAttempt = refundAttempt
  }
}

/* Workers AI hides its error code in non-enumerable properties, which plain
 * JSON.stringify(err) drops. Log this on every failure -- the first real
 * exhaustion event then hands over the exact shape, so the keyword guess below
 * can be replaced with a code check. */
export function describeAiError(err: unknown): string {
  if (err instanceof Error) {
    const own: Record<string, unknown> = {}
    for (const k of Object.getOwnPropertyNames(err)) own[k] = (err as unknown as never)[k]
    try {
      return JSON.stringify(own)
    } catch {
      return `${err.name}: ${err.message}`
    }
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/* We have never seen the real exhaustion error, so this cannot be a code match.
 * Deliberately narrow: 429 and "rate limit" are absent because those are
 * transient and should retry soon, not wait for the daily reset. A miss costs a
 * few wasted Neurons, never a lost screenshot. */
const QUOTA_HINTS = [
  'neuron',
  'quota',
  'daily limit',
  'out of credit',
  'insufficient',
  'billing',
  'payment required',
  'not entitled',
  'upgrade',
  '402',
]

export const looksLikeQuota = (described: string) => {
  const s = described.toLowerCase()
  return QUOTA_HINTS.some((h) => s.includes(h))
}

function toBase64(bytes: Uint8Array): string {
  // Native single-pass where available; the chunked fallback avoids blowing the
  // argument limit that a bare fromCharCode(...bytes) would hit.
  const native = (bytes as unknown as { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export type ImageResult = { ok: true; url: string } | { ok: false; reason: string }

export async function imageDataUrl(env: Env, shot: Screenshot): Promise<ImageResult> {
  if (shot.size > AI_INLINE_MAX_BYTES) {
    return { ok: false, reason: `Image too large to parse (${Math.round(shot.size / 1024)} KB)` }
  }
  const object = await env.SHOTS.get(shot.r2Key)
  if (!object) return { ok: false, reason: 'Image missing from storage' }

  const bytes = new Uint8Array(await object.arrayBuffer())
  // The row's real content type, not a hardcoded jpeg: an iPhone HEIC mislabelled
  // as JPEG is either rejected by the model or silently misread.
  return { ok: true, url: `data:${shot.contentType};base64,${toBase64(bytes)}` }
}

export type ModelCall = { raw: unknown; neurons: number | null }

export async function callModel(env: Env, imageUrl: string): Promise<ModelCall> {
  let out: AiRunOutput
  try {
    out = (await env.AI.run(
      PARSE_MODEL as never,
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        guided_json: SCHEMA,
        max_tokens: 512,
        temperature: 0.1,
      } as never,
    )) as AiRunOutput
  } catch (err) {
    const described = describeAiError(err)
    console.error('workers-ai call failed', described)
    throw new AiUnavailableError(described.slice(0, 300), looksLikeQuota(described))
  }

  // guided_json normally pre-parses into `response`; fall back to the raw text.
  let raw = out.response
  if (typeof raw !== 'object' || raw === null) {
    const content = out.choices?.[0]?.message?.content
    if (typeof content !== 'string') return { raw: null, neurons: out.usage?.neurons ?? null }
    const match = /\{[\s\S]*\}/.exec(content)
    try {
      raw = match ? JSON.parse(match[0]) : null
    } catch {
      raw = null
    }
  }
  return { raw, neurons: out.usage?.neurons ?? null }
}

import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { payments, screenshots, type Screenshot } from '../db/schema'
import { callModel, imageDataUrl } from './ai'
import { normalizeExtraction, type ExtractedPayment, type ParseOutcome } from './extract'

export type { ExtractedPayment, ParseOutcome }

/* Only the id travels. The consumer holds the same D1 and R2 bindings, so
 * anything else in the message is a copy that can go stale between the send
 * and a redelivery -- which Queues may delay by up to 24 hours, and retains
 * for up to 14 days. A signed URL in here would have expired by then; an id
 * never does. */
export type ParseMessage = { screenshotId: string }

/* Past this the sweep calls it terminal rather than re-enqueueing something
 * that has never once succeeded. Deliberately higher than the queue's own
 * max_retries: those cover one bad delivery, this covers a bad screenshot. */
export const MAX_PARSE_ATTEMPTS = 5

export const enqueueParse = (env: Env, screenshotId: string) =>
  env.PARSE_QUEUE.send({ screenshotId } satisfies ParseMessage)

/* Claim a screenshot for parsing. Conditional on 'pending' and atomic, so this
 * is the idempotency gate: Queues deliver at least once, and the duplicate
 * finds nothing to claim and gets null. That is the normal outcome of a
 * redelivery, not an error. */
export async function claimForParse(env: Env, id: string): Promise<Screenshot | null> {
  const rows = await db(env.DB)
    .update(screenshots)
    .set({
      parseStatus: 'processing',
      parseStatusAt: Date.now(),
      parseAttempts: sql`${screenshots.parseAttempts} + 1`,
    })
    .where(and(eq(screenshots.id, id), eq(screenshots.parseStatus, 'pending')))
    .returning()
  return rows[0] ?? null
}

export type SaveResult = { kind: 'saved' } | { kind: 'duplicate'; ofPaymentId: string }

/* SQLite reports which index failed; D1 passes the message through. Matching on
 * the column name is what separates "this transaction is already recorded" from
 * any other constraint problem. */
const isDuplicateTxn = (err: unknown) =>
  err instanceof Error && /unique constraint failed[^]*unique_id/i.test(err.message)

async function findByTxn(env: Env, userId: string, uniqueId: string) {
  const rows = await db(env.DB)
    .select({ id: payments.id, screenshotId: payments.screenshotId })
    .from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.uniqueId, uniqueId)))
    .limit(1)
  return rows[0] ?? null
}

/* The payment row and the 'done' flip in one D1 batch, which is an implicit
 * transaction -- so there is no window where a screenshot reads as accounted
 * for while its payment is missing.
 *
 * Two different identities are in play and they do different jobs:
 * screenshotId dedupes the IMAGE (a redelivery or a deliberate re-parse
 * updates in place), uniqueId dedupes the PAYMENT (a second screenshot of a
 * transaction we already have is rejected outright). */
export async function savePaymentAndMarkParsed(
  env: Env,
  shot: Screenshot,
  p: ExtractedPayment,
): Promise<SaveResult> {
  const d = db(env.DB)
  const now = Date.now()

  /* Checked up front so the duplicate path is ordinary control flow rather
   * than an exception; the unique index below is still the backstop for two
   * consumers racing the same transaction. */
  if (p.uniqueId) {
    const hit = await findByTxn(env, shot.userId, p.uniqueId)
    if (hit && hit.screenshotId !== shot.id) return { kind: 'duplicate', ofPaymentId: hit.id }
  }

  try {
    await d.batch([
      d
        .insert(payments)
        .values({
          id: crypto.randomUUID(),
          userId: shot.userId,
          amount: p.amount,
          payee: p.payee,
          notes: p.notes,
          paidAt: p.paidAt,
          uniqueId: p.uniqueId,
          screenshotId: shot.id,
          mode: 'screenshot',
          status: 'pending_approval',
          createdAt: now,
        })
        /* A re-parse replaces. id, userId, mode and createdAt stay put so the row
         * keeps its identity, and status returns to pending_approval because an
         * approval of the old numbers says nothing about the new ones. */
        .onConflictDoUpdate({
          target: payments.screenshotId,
          set: {
            amount: p.amount,
            payee: p.payee,
            notes: p.notes,
            paidAt: p.paidAt,
            uniqueId: p.uniqueId,
            status: 'pending_approval',
          },
        }),
      d
        .update(screenshots)
        .set({ parseStatus: 'done', parseStatusAt: now, parseError: null })
        .where(and(eq(screenshots.id, shot.id), eq(screenshots.parseStatus, 'processing'))),
    ])
  } catch (err) {
    if (p.uniqueId && isDuplicateTxn(err)) {
      const hit = await findByTxn(env, shot.userId, p.uniqueId)
      if (hit) return { kind: 'duplicate', ofPaymentId: hit.id }
    }
    throw err
  }
  return { kind: 'saved' }
}

/** Terminal and correct: the model read it and it genuinely is not a payment. */
export async function markNoPayment(env: Env, id: string) {
  await db(env.DB)
    .update(screenshots)
    .set({ parseStatus: 'no_payment', parseStatusAt: Date.now(), parseError: null })
    .where(and(eq(screenshots.id, id), eq(screenshots.parseStatus, 'processing')))
}

/* The one case where the consumer, not the sweep, writes something terminal.
 * The sweep's 'failed' means "out of attempts"; this one means "the model
 * answered and the answer is unusable", which no number of attempts changes.
 * Two writers, two meanings -- documented so they do not drift. */
export async function failParse(env: Env, id: string, error: string) {
  await db(env.DB)
    .update(screenshots)
    .set({ parseStatus: 'failed', parseStatusAt: Date.now(), parseError: error.slice(0, 500) })
    .where(and(eq(screenshots.id, id), eq(screenshots.parseStatus, 'processing')))
}

/* Hand the screenshot back so a redelivery can claim it. The consumer never
 * writes 'failed' through this path -- Queues owns the retry budget and the
 * sweep decides when something is terminal. */
export async function releaseParse(
  env: Env,
  id: string,
  error: string,
  opts?: { refundAttempt?: boolean },
) {
  await db(env.DB)
    .update(screenshots)
    .set({
      parseStatus: 'pending',
      parseStatusAt: Date.now(),
      parseError: error.slice(0, 500),
      /* MAX_PARSE_ATTEMPTS is a budget for bad screenshots. A service outage is
       * not a bad screenshot -- without the refund a Neuron wall would spend
       * all five attempts in under a minute and hand a perfectly good image to
       * the sweep to mark 'failed'. */
      ...(opts?.refundAttempt
        ? { parseAttempts: sql`max(${screenshots.parseAttempts} - 1, 0)` }
        : {}),
    })
    .where(and(eq(screenshots.id, id), eq(screenshots.parseStatus, 'processing')))
}

/** Throws AiUnavailableError when the service is the problem; returns otherwise. */
export async function runParse(env: Env, shot: Screenshot): Promise<ParseOutcome> {
  const image = await imageDataUrl(env, shot)
  if (!image.ok) return { kind: 'invalid', reason: image.reason }

  const { raw, neurons } = await callModel(env, image.url)
  console.log(`parsed ${shot.id} neurons=${neurons ?? '?'}`)
  return normalizeExtraction(raw, shot)
}

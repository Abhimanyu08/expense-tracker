import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { screenshots, type Screenshot } from '../db/schema'

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

export async function markParsed(env: Env, id: string) {
  await db(env.DB)
    .update(screenshots)
    .set({ parseStatus: 'done', parseStatusAt: Date.now(), parseError: null })
    .where(and(eq(screenshots.id, id), eq(screenshots.parseStatus, 'processing')))
}

/* Hand the screenshot back so a redelivery can claim it. The consumer never
 * writes 'failed' -- Queues owns the retry budget and the sweep decides when
 * something is terminal. Two places deciding that would drift apart. */
export async function releaseParse(env: Env, id: string, error: string) {
  await db(env.DB)
    .update(screenshots)
    .set({ parseStatus: 'pending', parseStatusAt: Date.now(), parseError: error.slice(0, 500) })
    .where(and(eq(screenshots.id, id), eq(screenshots.parseStatus, 'processing')))
}

/* Stand-in for the AI call. It sleeps rather than returning immediately
 * because the property worth exercising is the one the real thing will have:
 * seconds of wall clock, near-zero CPU. That combination is what makes this
 * viable on the free plan, and what makes consumer concurrency matter. */
export async function runParse(_env: Env, _shot: Screenshot): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5_000))
}

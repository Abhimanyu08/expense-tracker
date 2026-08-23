import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import { db } from './db'
import { screenshots } from './db/schema'
import {
  MAX_PARSE_ATTEMPTS,
  claimForParse,
  markParsed,
  releaseParse,
  runParse,
  type ParseMessage,
} from './lib/parse'

const RETRY_DELAY_SECONDS = 10

/** Consumer. One screenshot per invocation -- see max_batch_size in wrangler.jsonc. */
export async function handleParseBatch(batch: MessageBatch<ParseMessage>, env: Env) {
  for (const message of batch.messages) {
    const { screenshotId } = message.body
    try {
      const shot = await claimForParse(env, screenshotId)
      if (!shot) {
        // Already parsed, already terminal, or in flight elsewhere. A duplicate
        // delivery landing here is the system working, so ack and move on.
        message.ack()
        continue
      }
      await runParse(env, shot)
      await markParsed(env, screenshotId)
      message.ack()
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error('parse failed', screenshotId, reason)
      await releaseParse(env, screenshotId, reason)
      /* retry() rather than rethrowing. An uncaught throw counts as a failed
       * invocation, and Queues factors the failure rate into autoscaling --
       * so one poison screenshot would slow down every other one. */
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS })
    }
  }
}

// Long enough that a screenshot in normal flight is never swept.
const PENDING_GRACE_MS = 2 * 60_000
// Just past the 15-minute consumer wall clock: nothing can still be running.
const PROCESSING_GRACE_MS = 16 * 60_000
// sendBatch caps at 100 messages, and the sweep sends exactly one batch.
const SWEEP_LIMIT = 100

/* Cron handler. Covers the two gaps the queue itself cannot: a send() that
 * threw after the row was already committed, and a consumer that died holding
 * a claim. Without this, either one is a screenshot that silently never gets
 * parsed and never shows up as broken. */
export async function sweepStalledParses(env: Env) {
  const now = Date.now()
  const d = db(env.DB)

  /* parseStatusAt 0, not `now`: it means "as stale as possible", so the SELECT
   * below re-enqueues the reclaimed row in this same pass instead of making it
   * wait out another whole cron interval. */
  await d
    .update(screenshots)
    .set({ parseStatus: 'pending', parseStatusAt: 0, parseError: 'Consumer did not finish' })
    .where(
      and(
        eq(screenshots.parseStatus, 'processing'),
        lt(screenshots.parseStatusAt, now - PROCESSING_GRACE_MS),
      ),
    )

  const stalled = await d
    .select({ id: screenshots.id, attempts: screenshots.parseAttempts })
    .from(screenshots)
    .where(
      and(
        eq(screenshots.parseStatus, 'pending'),
        lt(screenshots.parseStatusAt, now - PENDING_GRACE_MS),
      ),
    )
    .orderBy(asc(screenshots.parseStatusAt))
    .limit(SWEEP_LIMIT)

  if (!stalled.length) return

  const retry = stalled.filter((r) => r.attempts < MAX_PARSE_ATTEMPTS).map((r) => r.id)
  const giveUp = stalled.filter((r) => r.attempts >= MAX_PARSE_ATTEMPTS).map((r) => r.id)

  if (giveUp.length) {
    await d
      .update(screenshots)
      .set({ parseStatus: 'failed', parseStatusAt: Date.now() })
      .where(inArray(screenshots.id, giveUp))
  }

  if (retry.length) {
    /* sendBatch, not a loop of send(): the free plan allows 50 subrequests per
     * invocation and each send() is one, so a loop would cap the sweep at ~45
     * screenshots and fail the rest. */
    await env.PARSE_QUEUE.sendBatch(retry.map((id) => ({ body: { screenshotId: id } })))
    // Only after the send lands, so a throw above leaves them for the next sweep.
    await d
      .update(screenshots)
      .set({ parseStatusAt: Date.now() })
      .where(inArray(screenshots.id, retry))
  }

  console.log(`sweep: re-enqueued ${retry.length}, gave up on ${giveUp.length}`)
}

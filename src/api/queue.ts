import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import { db } from './db'
import { screenshots } from './db/schema'
import { AiUnavailableError } from './lib/ai'
import { deleteScreenshot } from './lib/store'
import {
  MAX_PARSE_ATTEMPTS,
  claimForParse,
  failParse,
  markNoPayment,
  releaseParse,
  runParse,
  savePaymentAndMarkParsed,
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

      const outcome = await runParse(env, shot)
      if (outcome.kind === 'payment') {
        const saved = await savePaymentAndMarkParsed(env, shot, outcome.payment)
        if (saved.kind === 'duplicate') {
          /* This exact transaction is already on the ledger from a different
           * screenshot -- shared to the PWA and also sent to the bot, say.
           * Discard the redundant image rather than leave a screenshot that
           * maps to no payment and would look like a parse failure. */
          console.log('duplicate payment, discarding screenshot', shot.id, saved.ofPaymentId)
          await deleteScreenshot(env, shot)
        }
      } else if (outcome.kind === 'no_payment') {
        await markNoPayment(env, screenshotId)
      } else {
        /* Terminal, not retried. The model answered and the answer is
         * unusable; at temperature 0.1 the same pixels produce the same
         * garbage, so a retry only spends Neurons. The reason lands in
         * parse_error where it can be read. */
        console.warn('parse unusable', screenshotId, outcome.reason)
        await failParse(env, screenshotId, outcome.reason)
      }
      message.ack()
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        /* The service, not the screenshot. Ack rather than retry: the row goes
         * back to 'pending' and the cron sweep owns bringing it back, whereas
         * retrying would burn all three queue retries against an outage that
         * can last until 00:00 UTC and then drop the message into the DLQ. */
        console.error('ai unavailable', screenshotId, err.message)
        await releaseParse(env, screenshotId, err.message, { refundAttempt: err.refundAttempt })
        message.ack()
        continue
      }
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

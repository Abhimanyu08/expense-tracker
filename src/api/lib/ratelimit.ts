import { eq } from 'drizzle-orm'
import { db } from '../db'
import { rateLimits } from '../db/schema'

/* Fixed-window counter in D1. Chosen over an in-memory map because Workers
 * isolates are not shared, so a map would reset constantly and limit nothing. */
export async function rateLimit(
  d1: D1Database,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now()
  const conn = db(d1)
  const existing = await conn.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1)
  const row = existing[0]

  if (!row || row.resetAt < now) {
    await conn
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: now + windowMs })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { count: 1, resetAt: now + windowMs },
      })
    return true
  }

  if (row.count >= limit) return false

  await conn
    .update(rateLimits)
    .set({ count: row.count + 1 })
    .where(eq(rateLimits.key, key))
  return true
}

export function clientIp(headers: Headers): string {
  return headers.get('cf-connecting-ip') ?? 'unknown'
}

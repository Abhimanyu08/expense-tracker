import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { sessions, users, type User } from '../db/schema'
import type { AppEnv } from '../types'

const COOKIE = 'sid'
const TTL_MS = 60 * 24 * 60 * 60 * 1000

/** Opaque token; the cookie carries no user data so sessions stay revocable. */
function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const id = newSessionId()
  const now = Date.now()
  await db(c.env.DB).insert(sessions).values({
    id,
    userId,
    createdAt: now,
    expiresAt: now + TTL_MS,
  })
  setCookie(c, COOKIE, id, {
    httpOnly: true,
    // Plain http on localhost during dev would reject a Secure cookie.
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(TTL_MS / 1000),
  })
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const id = getCookie(c, COOKIE)
  if (id) await db(c.env.DB).delete(sessions).where(eq(sessions.id, id))
  deleteCookie(c, COOKIE, { path: '/' })
}

export async function currentUser(c: Context<AppEnv>): Promise<User | null> {
  const id = getCookie(c, COOKIE)
  if (!id) return null

  const rows = await db(c.env.DB)
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.expiresAt < Date.now()) {
    await db(c.env.DB).delete(sessions).where(eq(sessions.id, id))
    return null
  }
  return row.user
}

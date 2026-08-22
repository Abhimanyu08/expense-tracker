import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users, type User } from '../db/schema'
import { hashPassword, verifyPassword } from '../lib/password'
import { normalizePhone } from '../lib/phone'
import { createSession, destroySession, currentUser } from '../lib/session'
import { rateLimit, clientIp } from '../lib/ratelimit'
import { requireUser } from '../middleware/auth'
import type { AppEnv } from '../types'
import type { PublicUser } from '../../shared/types'

const MIN_PASSWORD = 8

const publicUser = (u: User): PublicUser => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  telegramLinked: u.telegramChatId != null,
  telegramUsername: u.telegramUsername,
})

const auth = new Hono<AppEnv>()

auth.post('/signup', async (c) => {
  const ip = clientIp(c.req.raw.headers)
  if (!(await rateLimit(c.env.DB, `signup:${ip}`, 10, 60 * 60 * 1000))) {
    return c.json({ error: 'Too many attempts. Try again later.' }, 429)
  }

  const body = await c.req.json<{ phone?: string; name?: string; password?: string }>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid body' }, 400)

  const phone = normalizePhone(body.phone ?? '')
  const name = (body.name ?? '').trim()
  const password = body.password ?? ''

  if (!phone) return c.json({ error: 'Enter a valid phone number' }, 400)
  if (name.length < 1 || name.length > 60) return c.json({ error: 'Enter your name' }, 400)
  if (password.length < MIN_PASSWORD) {
    return c.json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400)
  }

  const existing = await db(c.env.DB).select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1)
  if (existing.length) return c.json({ error: 'That number is already registered' }, 409)

  const user: User = {
    id: crypto.randomUUID(),
    phone,
    name,
    passwordHash: await hashPassword(password),
    createdAt: Date.now(),
    telegramChatId: null,
    telegramUsername: null,
  }
  await db(c.env.DB).insert(users).values(user)
  await createSession(c, user.id)
  return c.json({ user: publicUser(user) }, 201)
})

auth.post('/login', async (c) => {
  const ip = clientIp(c.req.raw.headers)
  const body = await c.req.json<{ phone?: string; password?: string }>().catch(() => null)
  if (!body) return c.json({ error: 'Invalid body' }, 400)

  const phone = normalizePhone(body.phone ?? '')
  if (!phone) return c.json({ error: 'Enter a valid phone number' }, 400)

  if (!(await rateLimit(c.env.DB, `login:${phone}:${ip}`, 10, 10 * 60 * 1000))) {
    return c.json({ error: 'Too many attempts. Try again in a few minutes.' }, 429)
  }

  const found = await db(c.env.DB).select().from(users).where(eq(users.phone, phone)).limit(1)
  const user = found[0]
  // Same message either way so the endpoint does not confirm which numbers exist.
  const invalid = c.json({ error: 'Wrong number or password' }, 401)
  if (!user) return invalid
  if (!(await verifyPassword(body.password ?? '', user.passwordHash))) return invalid

  await createSession(c, user.id)
  return c.json({ user: publicUser(user) })
})

auth.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

auth.get('/me', async (c) => {
  const user = await currentUser(c)
  return user ? c.json({ user: publicUser(user) }) : c.json({ user: null })
})

auth.delete('/sessions', requireUser, async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

export default auth

import { createMiddleware } from 'hono/factory'
import { currentUser } from '../lib/session'
import type { AppEnv } from '../types'

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  c.set('user', user)
  await next()
})

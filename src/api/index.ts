import { Hono } from 'hono'
import auth from './routes/auth'
import screenshots from './routes/screenshots'
import telegram from './routes/telegram'
import { currentUser } from './lib/session'
import { storeScreenshot } from './lib/store'
import { handleParseBatch, sweepStalledParses } from './queue'
import type { ParseMessage } from './lib/parse'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

app.route('/api/auth', auth)
app.route('/api/screenshots', screenshots)
app.route('/api/telegram', telegram)

// Unmatched API paths must not fall through to the SPA shell, or a typo'd
// endpoint returns 200 and a page of HTML to a fetch() expecting JSON.
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

/* Normally unreachable: the service worker intercepts this POST and queues the
 * file in the outbox without touching the network. It fires only when the SW
 * is missing or not yet controlling the page, so treat it as a safety net --
 * store the screenshot if we can identify the user, and otherwise send them to
 * the app with a flag rather than silently dropping their share. */
app.post('/share-target', async (c) => {
  const user = await currentUser(c)
  if (!user) return c.redirect('/?share=login-required', 303)

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('image') ?? form?.get('file')
  if (!(file instanceof File)) return c.redirect('/?share=empty', 303)

  const result = await storeScreenshot(c.env, user.id, file, 'share-target')
  return c.redirect(result.ok ? '/?shared=1' : '/?share=failed', 303)
})

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

/* The parse consumer rides on this same Worker rather than a separate one. It
 * keeps `wrangler dev` simulating the whole producer -> queue -> consumer loop
 * in one session, which is worth more right now than isolation. Split it out
 * when the consumer needs its own cpu_ms, or when its errors start affecting
 * the site. */
export default {
  fetch: app.fetch,
  queue: handleParseBatch,
  scheduled: (_controller, env) => sweepStalledParses(env),
} satisfies ExportedHandler<Env, ParseMessage>

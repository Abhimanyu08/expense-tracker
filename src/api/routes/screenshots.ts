import { Hono, type Context } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { screenshots, type Screenshot } from '../db/schema'
import { requireUser } from '../middleware/auth'
import { deleteScreenshot, storeScreenshot, toDTO } from '../lib/store'
import type { AppEnv } from '../types'

const route = new Hono<AppEnv>()
route.use('*', requireUser)

route.get('/', async (c) => {
  const rows = await db(c.env.DB)
    .select()
    .from(screenshots)
    .where(eq(screenshots.userId, c.get('user').id))
    .orderBy(desc(screenshots.createdAt))
    .limit(200)
  return c.json({ screenshots: rows.map(toDTO) })
})

route.post('/', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('image')
  if (!(file instanceof File)) return c.json({ error: 'Expected an "image" file field' }, 400)

  const source: Screenshot['source'] =
    form?.get('source') === 'share-target' ? 'share-target' : 'upload'

  // The browser decoded the image to downscale it, so it can tell us the real
  // dimensions. Absent or junk values just leave the columns null.
  const width = Number(form?.get('width'))
  const height = Number(form?.get('height'))
  const dimensions =
    Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
      ? { width, height }
      : undefined

  const result = await storeScreenshot(c.env, c.get('user').id, file, source, dimensions)
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ screenshot: toDTO(result.row) }, 201)
})

async function ownedRow(c: Context<AppEnv>) {
  const rows = await db(c.env.DB)
    .select()
    .from(screenshots)
    .where(
      and(eq(screenshots.id, c.req.param('id') ?? ''), eq(screenshots.userId, c.get('user').id)),
    )
    .limit(1)
  return rows[0] ?? null
}

route.get('/:id/image', async (c) => {
  const row = await ownedRow(c)
  if (!row) return c.json({ error: 'Not found' }, 404)

  const object = await c.env.SHOTS.get(row.r2Key)
  if (!object) return c.json({ error: 'Image missing from storage' }, 404)

  if (c.req.header('if-none-match') === object.httpEtag) return new Response(null, { status: 304 })

  return new Response(object.body, {
    headers: {
      'content-type': row.contentType,
      etag: object.httpEtag,
      // Bytes for a given id never change, and these are payment screenshots,
      // so cache hard but keep them out of shared caches.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
})

route.delete('/:id', async (c) => {
  const row = await ownedRow(c)
  if (!row) return c.json({ error: 'Not found' }, 404)
  await deleteScreenshot(c.env, row)
  return c.json({ ok: true })
})

export default route

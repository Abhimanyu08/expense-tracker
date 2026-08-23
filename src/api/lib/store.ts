import { db } from '../db'
import { screenshots, type Screenshot } from '../db/schema'
import { enqueueParse } from './parse'
import type { ScreenshotDTO } from '../../shared/types'

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])

/* A share target can hand over a file with an empty or bogus MIME type, so fall
 * back to magic bytes rather than rejecting a screenshot that is genuinely fine. */
function sniffType(bytes: Uint8Array): string | null {
  const at = (offset: number, ...sig: number[]) => sig.every((b, i) => bytes[offset + i] === b)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12))
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
  }
  return null
}

export const toDTO = (row: Screenshot): ScreenshotDTO => ({
  id: row.id,
  source: row.source,
  contentType: row.contentType,
  size: row.size,
  createdAt: row.createdAt,
  width: row.width,
  height: row.height,
  parseStatus: row.parseStatus,
  imageUrl: `/api/screenshots/${row.id}/image`,
})

export type StoreResult =
  { ok: true; row: Screenshot } | { ok: false; status: 400 | 413 | 415; error: string }

/** Shared by the API upload route and the server-side share-target fallback. */
export async function storeScreenshot(
  env: Env,
  userId: string,
  file: File,
  source: Screenshot['source'],
  dimensions?: { width: number; height: number },
): Promise<StoreResult> {
  if (file.size === 0) return { ok: false, status: 400, error: 'Empty file' }
  if (file.size > MAX_BYTES) return { ok: false, status: 413, error: 'Image is larger than 10 MB' }

  const buffer = await file.arrayBuffer()
  const contentType = ALLOWED.has(file.type)
    ? file.type
    : sniffType(new Uint8Array(buffer.slice(0, 16)))
  if (!contentType) {
    return { ok: false, status: 415, error: `Unsupported file type: ${file.type || 'unknown'}` }
  }

  const row: Screenshot = {
    id: crypto.randomUUID(),
    userId,
    r2Key: `u/${userId}/${crypto.randomUUID()}`,
    contentType,
    size: buffer.byteLength,
    source,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    createdAt: Date.now(),
    parseStatus: 'pending',
    parseStatusAt: Date.now(),
    parseAttempts: 0,
    parseError: null,
  }

  await env.SHOTS.put(row.r2Key, buffer, { httpMetadata: { contentType } })
  // Enqueue only after the row is committed -- the consumer looks the
  // screenshot up by id, and can beat the insert otherwise.
  await db(env.DB).insert(screenshots).values(row)

  /* A failed send must not fail the upload: the bytes and the row are already
   * safe, and losing the user's screenshot to punish a queue blip would be
   * absurd. The row stays 'pending' and the cron sweep re-enqueues it. */
  try {
    await enqueueParse(env, row.id)
  } catch (err) {
    console.error('enqueue failed, leaving for the sweep', row.id, err)
  }

  return { ok: true, row }
}

import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { linkTokens, telegramAlbums, telegramUpdates, users, type User } from '../db/schema'
import { requireUser } from '../middleware/auth'
import { storeScreenshot } from '../lib/store'
import { Telegram, TG_MAX_DOWNLOAD, typeFromPath, type TgMessage, type TgUpdate } from '../lib/telegram'
import type { AppEnv } from '../types'

const LINK_TTL_MS = 15 * 60 * 1000

const NOT_LINKED =
  'This chat is not linked to a Kharcha account yet.\n\n' +
  'Open Kharcha, tap "Connect Telegram", and follow the link it gives you.'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

async function userForChat(env: Env, chatId: number): Promise<User | null> {
  const rows = await db(env.DB).select().from(users).where(eq(users.telegramChatId, chatId)).limit(1)
  return rows[0] ?? null
}

type Media = {
  fileId: string
  width?: number
  height?: number
  size?: number
  filename?: string
}

function pickMedia(msg: TgMessage): Media | null {
  if (msg.photo?.length) {
    // Telegram sends several sizes; the last is the largest it kept.
    const largest = msg.photo.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
    return {
      fileId: largest.file_id,
      width: largest.width,
      height: largest.height,
      size: largest.file_size,
    }
  }
  const doc = msg.document
  if (doc && (doc.mime_type ?? '').startsWith('image/')) {
    return { fileId: doc.file_id, size: doc.file_size, filename: doc.file_name }
  }
  return null
}

/* An album has no "complete" signal, so the first photo posts a reply and the
 * rest edit it. The counter is incremented in one atomic upsert, so exactly one
 * update sees count === 1 and owns the send. */
async function replyForAlbum(env: Env, tg: Telegram, msg: TgMessage, describe: (n: number) => string) {
  const conn = db(env.DB)
  const groupId = msg.media_group_id!
  const rows = await conn
    .insert(telegramAlbums)
    .values({
      mediaGroupId: groupId,
      chatId: msg.chat.id,
      messageId: null,
      count: 1,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: telegramAlbums.mediaGroupId,
      set: { count: sql`${telegramAlbums.count} + 1` },
    })
    .returning()

  const album = rows[0]
  if (album.count === 1) {
    const sent = await tg.sendMessage(msg.chat.id, describe(1))
    await conn
      .update(telegramAlbums)
      .set({ messageId: sent.message_id })
      .where(eq(telegramAlbums.mediaGroupId, groupId))
    return
  }

  let messageId = album.messageId
  if (!messageId) {
    // The first photo's reply is probably still in flight.
    await sleep(500)
    const fresh = await conn
      .select()
      .from(telegramAlbums)
      .where(eq(telegramAlbums.mediaGroupId, groupId))
      .limit(1)
    messageId = fresh[0]?.messageId ?? null
  }
  if (messageId) await tg.editMessageText(msg.chat.id, messageId, describe(album.count))
}

async function handleStart(env: Env, tg: Telegram, msg: TgMessage, text: string) {
  const chatId = msg.chat.id
  const payload = text.slice('/start'.length).trim()

  if (!payload) {
    const existing = await userForChat(env, chatId)
    return tg.sendMessage(
      chatId,
      existing
        ? `Already linked to ${existing.name}. Send me a payment screenshot and it will show up in Kharcha.`
        : NOT_LINKED,
    )
  }

  const conn = db(env.DB)
  const found = await conn.select().from(linkTokens).where(eq(linkTokens.token, payload)).limit(1)
  const token = found[0]

  if (!token) return tg.sendMessage(chatId, 'That link is not valid. Generate a fresh one in Kharcha.')
  if (token.usedAt) return tg.sendMessage(chatId, 'That link was already used. Generate a fresh one in Kharcha.')
  if (token.expiresAt < Date.now()) return tg.sendMessage(chatId, 'That link expired. Generate a fresh one in Kharcha.')

  // telegram_chat_id is unique, so bail before the update rather than on the constraint.
  const owner = await userForChat(env, chatId)
  if (owner && owner.id !== token.userId) {
    return tg.sendMessage(chatId, 'This Telegram account is already linked to a different Kharcha account.')
  }

  await conn
    .update(users)
    .set({ telegramChatId: chatId, telegramUsername: msg.from?.username ?? null })
    .where(eq(users.id, token.userId))
  await conn.update(linkTokens).set({ usedAt: Date.now() }).where(eq(linkTokens.token, payload))

  const linked = await conn.select().from(users).where(eq(users.id, token.userId)).limit(1)
  return tg.sendMessage(
    chatId,
    `Linked to ${linked[0]?.name ?? 'your account'}.\n\nSend me a payment screenshot and it will show up in Kharcha.`,
  )
}

async function handleMessage(env: Env, tg: Telegram, msg: TgMessage) {
  const text = (msg.text ?? '').trim()
  if (text.startsWith('/start')) return handleStart(env, tg, msg, text)

  const user = await userForChat(env, msg.chat.id)
  if (!user) return tg.sendMessage(msg.chat.id, NOT_LINKED)

  const media = pickMedia(msg)
  if (!media) {
    return tg.sendMessage(msg.chat.id, 'Send me a screenshot of a payment and I will save it to Kharcha.')
  }
  if ((media.size ?? 0) > TG_MAX_DOWNLOAD) {
    return tg.sendMessage(msg.chat.id, 'That file is over the 20 MB a bot is allowed to download.')
  }

  const { bytes, path } = await tg.download(media.fileId)
  const filename = media.filename ?? path.split('/').pop() ?? 'telegram-image'
  const file = new File([bytes], filename, { type: typeFromPath(path) })

  const dimensions =
    media.width && media.height ? { width: media.width, height: media.height } : undefined
  const result = await storeScreenshot(env, user.id, file, 'telegram', dimensions)
  if (!result.ok) return tg.sendMessage(msg.chat.id, `Could not save that: ${result.error}`)

  // Dimensions are in the reply on purpose -- it is the cheapest way to see what
  // Telegram's recompression actually leaves for the parser to work with.
  const detail = `${result.row.width ?? '?'}×${result.row.height ?? '?'} · ${formatSize(result.row.size)}`

  if (msg.media_group_id) {
    return replyForAlbum(env, tg, msg, (n) => `Saved ${n} screenshot${n === 1 ? '' : 's'} · ${detail}`)
  }
  return tg.sendMessage(msg.chat.id, `Saved ✓  ${detail}`)
}

const telegram = new Hono<AppEnv>()

telegram.post('/webhook', async (c) => {
  if (c.req.header('x-telegram-bot-api-secret-token') !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const update = await c.req.json<TgUpdate>().catch(() => null)
  if (!update || typeof update.update_id !== 'number') return c.json({ ok: true })

  // Telegram retries anything that is not a fast 2xx, so claim the update id
  // before doing any work. A retry then lands here and stops.
  const claimed = await db(c.env.DB)
    .insert(telegramUpdates)
    .values({ updateId: update.update_id, receivedAt: Date.now() })
    .onConflictDoNothing()
    .returning({ updateId: telegramUpdates.updateId })
  if (!claimed.length) return c.json({ ok: true, duplicate: true })

  const message = update.message
  if (!message) return c.json({ ok: true })

  const tg = new Telegram(c.env.TELEGRAM_BOT_TOKEN)
  try {
    await handleMessage(c.env, tg, message)
  } catch (err) {
    // Always answer 200. A non-2xx would make Telegram retry, and the retry is
    // already deduped away above -- so tell the user instead of failing silently.
    console.error('telegram handler failed', err)
    await tg
      .sendMessage(message.chat.id, 'Something went wrong saving that. Please send it again.')
      .catch(() => {})
  }
  return c.json({ ok: true })
})

telegram.post('/link-token', requireUser, async (c) => {
  const user = c.get('user')
  // Telegram start payloads allow 1-64 chars of [A-Za-z0-9_-].
  const raw = crypto.getRandomValues(new Uint8Array(24))
  const token = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const now = Date.now()
  await db(c.env.DB).insert(linkTokens).values({
    token,
    userId: user.id,
    createdAt: now,
    expiresAt: now + LINK_TTL_MS,
    usedAt: null,
  })

  return c.json({
    url: `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${token}`,
    expiresAt: now + LINK_TTL_MS,
  })
})

telegram.post('/unlink', requireUser, async (c) => {
  await db(c.env.DB)
    .update(users)
    .set({ telegramChatId: null, telegramUsername: null })
    .where(eq(users.id, c.get('user').id))
  return c.json({ ok: true })
})

export default telegram

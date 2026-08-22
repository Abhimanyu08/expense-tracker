import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  // One Telegram account per user. Unique so a chat cannot feed two accounts.
  telegramChatId: integer('telegram_chat_id').unique(),
  telegramUsername: text('telegram_username'),
})

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const screenshots = sqliteTable(
  'screenshots',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    r2Key: text('r2_key').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    // 'telegram' is unused until the bot lands, but declaring it now keeps the
    // column stable so the bot does not force a migration.
    source: text('source', { enum: ['upload', 'share-target', 'telegram'] }).notNull(),
    // Recorded mainly to see what Telegram's recompression leaves behind.
    width: integer('width'),
    height: integer('height'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('screenshots_user_created_idx').on(t.userId, t.createdAt)],
)

// Coarse abuse brake for signup/login. Not a general-purpose limiter -- it
// exists because there is no OTP, so guessing a phone number is the attack.
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: integer('reset_at').notNull(),
})

/* One-time deep-link tokens. The PWA mints one, the user taps through to
 * t.me/<bot>?start=<token>, and the bot binds that chat to this account. */
export const linkTokens = sqliteTable('link_tokens', {
  token: text('token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
})

/* Telegram retries any webhook it does not get a fast 2xx for, and Queues
 * deliver at least once, so update_id is the idempotency key that stops one
 * screenshot from becoming several expenses. */
export const telegramUpdates = sqliteTable('telegram_updates', {
  updateId: integer('update_id').primaryKey(),
  receivedAt: integer('received_at').notNull(),
})

/* An album arrives as N separate updates sharing a media_group_id, with no
 * "album complete" signal. Track the reply we sent for the group so later
 * photos edit that message instead of spamming a new one each. */
export const telegramAlbums = sqliteTable('telegram_albums', {
  mediaGroupId: text('media_group_id').primaryKey(),
  chatId: integer('chat_id').notNull(),
  messageId: integer('message_id'),
  count: integer('count').notNull(),
  createdAt: integer('created_at').notNull(),
})

export type User = typeof users.$inferSelect
export type Screenshot = typeof screenshots.$inferSelect

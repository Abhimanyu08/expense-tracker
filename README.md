# Kharcha

Screenshot-first expense tracking. Sign in, get screenshots in from
anywhere, see them in a list. No parsing, expenses, splits, or tags yet — the queue
and AI arrive with those.

**Live:** https://split-probe.iamabhimanyu08.workers.dev

## Why it is a PWA

A [capability probe](./brain-dump.md) was deployed and tested on real devices first.
The result: iOS Safari supports **neither** Web Share Target nor the Contact Picker
API; Android Chrome supports both. Native was priced out — ~$124/year in developer
fees plus a TestFlight re-upload every 90 days, to serve a handful of friends.

So: the Android share target is the fast ingest path, and a Telegram bot covers iOS.
Contact import on iOS remains genuinely unsolved.

## Stack

React + Vite + Tailwind v4 + shadcn/ui + TanStack Query on the front, Hono on
Cloudflare Workers behind it. D1 (via Drizzle) holds rows, **R2 holds the image
bytes** — screenshots do not belong in SQLite. One Worker serves both the API and
the built SPA.

## Develop

```sh
npm install
npm run db:migrate:local     # apply migrations to the local D1
npm run dev                  # http://localhost:5173 — SPA and Worker in one server
```

The Cloudflare Vite plugin runs the Worker in workerd with local D1 and R2, so
dev behaves like production. Cookies are marked `Secure` only over https, so
plain-http localhost still works.

## Deploy

```sh
npm run db:generate          # after changing src/api/db/schema.ts
npm run db:migrate           # apply to remote D1
npm run deploy               # vite build && wrangler deploy
npm run tail                 # live logs, including per-request cpuTime
```

The Worker is still named `split-probe`. Renaming changes the workers.dev URL and
breaks any already-installed PWA, so it stays until a custom domain is attached.

## How a shared screenshot gets in

The manifest declares a `share_target`; the service worker intercepts that
multipart POST and **parks the file in an IndexedDB outbox** rather than uploading
it inline. The app drains the outbox on next boot.

That indirection is the whole point: a share can arrive with an expired session or
no network, and parking it first means it is retried later instead of lost. A file
the server permanently rejects (400/413/415) is dropped from the outbox so one bad
item cannot jam every later share.

`public/outbox.js` is a classic script on purpose — the service worker pulls it in
with `importScripts` and `index.html` loads the same file, so both sides share one
implementation instead of two copies that drift.

If a share ever reaches `POST /share-target` on the server, the service worker
missed it. The Worker handles that case rather than 405-ing, which makes the
failure visible instead of silent.

## Telegram ingest (the iOS path)

Bot: **@kharchapecharchabot**. Because iOS cannot share into a web app, screenshots
get there through Telegram instead.

**Linking** uses a one-time deep-link token, not the Login Widget. The PWA mints a
token, navigates to `t.me/<bot>?start=<token>`, and the bot binds that chat to the
account. This is an app-to-app handoff — a standalone iOS PWA handles the Widget's
popup to `oauth.telegram.org` badly, and can strand the callback in Safari.

**The webhook** (`POST /api/telegram/webhook`) verifies the
`X-Telegram-Bot-Api-Secret-Token` header, then claims `update_id` in D1 before
doing any work. Telegram retries anything that is not a fast 2xx, so the claim is
what stops one screenshot from becoming several. It always answers 200 — a
non-2xx would trigger a retry that the dedupe drops anyway, so failures are
reported to the user in-chat rather than swallowed.

**Albums** arrive as N separate updates sharing a `media_group_id` with no
"complete" signal. The counter is incremented in one atomic upsert, so exactly one
update sees `count === 1` and owns sending the reply; the rest edit that message.
One reply per album, with a live count.

The bot's reply includes the image dimensions on purpose — that is the cheapest way
to see what Telegram's recompression actually leaves for a parser to read.

```sh
npm run tg:set     # register the webhook for the current deployment
npm run tg:info    # url, pending count, last error
```

Secrets live as Worker secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`)
and in `.dev.vars` for local dev. `.dev.vars` is gitignored.

## Layout

```
src/api/          Hono app: routes/ (auth, screenshots, telegram), db/, lib/
src/web/          React app: routes/, components/ui/ (shadcn), lib/
src/shared/       types shared across the boundary
public/           manifest, icons, sw.js, outbox.js
drizzle/          migrations (wrangler.jsonc points migrations_dir here)
scripts/          icon generator, telegram webhook helper
```

## Notes

- Passwords use **PBKDF2 via WebCrypto** — bcrypt and argon2 are native modules and
  do not run on Workers. Measured at ~43 ms CPU per login at 100k iterations, which
  production accepts comfortably. `ITERATIONS` in `src/api/lib/password.ts` is the
  single knob; verification reads the count from the stored hash, so raising it
  will not lock out existing users.
- **There is no OTP.** Anyone can register with a number that is not theirs. This is
  a known, accepted tradeoff; login and signup are rate-limited in D1 as the only
  mitigation.
- R2 stays private. Images are served through an auth-checked Worker route, not a
  public bucket URL, because these are payment screenshots.

import { useEffect, useRef, useState } from 'react'
import { Ban, Clock, ImageOff, Loader2, LogOut, Plus, Trash2, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/web/components/ui/badge'
import { Button } from '@/web/components/ui/button'
import { useDeleteScreenshot, useLogout, useScreenshots, useUpload } from '@/web/lib/queries'
import { useDrainOutbox } from '@/web/lib/useDrainOutbox'
import { TelegramCard } from '@/web/components/TelegramCard'
import type { ParseStatus, PublicUser, ScreenshotDTO } from '@/shared/types'

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatWhen(ms: number) {
  const date = new Date(ms)
  const sameDay = new Date().toDateString() === date.toDateString()
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** Reads the flag the share-target redirect leaves behind, then clears the URL. */
function useShareNotice() {
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const shared = params.get('shared')
    const failed = params.get('share')
    if (shared && Number(shared) > 0)
      setNotice(`Received ${shared} screenshot(s) from the share sheet.`)
    else if (failed === 'login-required') setNotice('Sign in first, then share again.')
    else if (failed) setNotice('That share could not be read.')
    if (shared || failed) window.history.replaceState(null, '', '/')
  }, [])
  return notice
}

type BadgeVariant = React.ComponentProps<typeof Badge>['variant']

/* 'done' is deliberately absent: once a screenshot is parsed there is nothing
 * to say about it, and a badge on every tile is noise. Each state maps onto a
 * stock Badge variant rather than hand-rolled colours, so a theme change or a
 * shadcn update carries these along with everything else. */
const PARSE_BADGE: Partial<
  Record<ParseStatus, { label: string; variant: BadgeVariant; icon: LucideIcon }>
> = {
  pending: { label: 'Queued', variant: 'secondary', icon: Clock },
  processing: { label: 'Parsing', variant: 'default', icon: Loader2 },
  no_payment: { label: 'Not a payment', variant: 'outline', icon: Ban },
  failed: { label: 'Failed', variant: 'destructive', icon: TriangleAlert },
}

function ParseBadge({ status }: { status: ParseStatus }) {
  const badge = PARSE_BADGE[status]
  if (!badge) return null
  const Icon = badge.icon
  return (
    <Badge variant={badge.variant} className="absolute top-1.5 left-1.5">
      <Icon className={status === 'processing' ? 'animate-spin' : undefined} />
      {badge.label}
    </Badge>
  )
}

function Tile({ shot }: { shot: ScreenshotDTO }) {
  const remove = useDeleteScreenshot()
  const [broken, setBroken] = useState(false)

  return (
    <div className="group bg-card relative overflow-hidden rounded-xl border">
      <div className="bg-secondary relative aspect-[3/4] w-full">
        <ParseBadge status={shot.parseStatus} />
        {broken ? (
          <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2">
            <ImageOff className="size-5" />
            <span className="px-2 text-center text-[11px]">{shot.contentType}</span>
          </div>
        ) : (
          <img
            src={shot.imageUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={() => setBroken(true)}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{formatWhen(shot.createdAt)}</p>
          <p className="text-muted-foreground truncate text-[11px]">
            {shot.source === 'share-target' ? 'shared' : shot.source} · {formatSize(shot.size)}
            {shot.width && shot.height ? ` · ${shot.width}×${shot.height}` : ''}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-8"
          aria-label="Delete screenshot"
          disabled={remove.isPending}
          onClick={() => remove.mutate(shot.id)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export default function Screenshots({ user }: { user: PublicUser }) {
  const shots = useScreenshots(true)
  const upload = useUpload()
  const logout = useLogout()
  const pending = useDrainOutbox(true)
  const notice = useShareNotice()
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pt-5 pb-24">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">Screenshots</h1>
          <p className="text-muted-foreground truncate text-sm">{user.name}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => logout.mutate()}>
          <LogOut className="size-4" />
        </Button>
      </header>

      <TelegramCard user={user} />

      {notice && (
        <p className="bg-primary/15 text-foreground mb-4 rounded-lg px-3 py-2 text-sm">{notice}</p>
      )}
      {pending > 0 && (
        <p className="bg-secondary text-muted-foreground mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Uploading {pending} shared item(s)…
        </p>
      )}
      {upload.error && (
        <p
          role="alert"
          className="bg-destructive/15 text-destructive mb-4 rounded-lg px-3 py-2 text-sm"
        >
          {upload.error.message}
        </p>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) upload.mutate(files)
          e.target.value = ''
        }}
      />

      {shots.isLoading ? (
        <p className="text-muted-foreground py-16 text-center text-sm">Loading…</p>
      ) : shots.data?.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shots.data.map((shot) => (
            <Tile key={shot.id} shot={shot} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium">No screenshots yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Upload one, or share a screenshot to Kharcha from the Android share sheet.
          </p>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 flex justify-center p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <Button
          size="lg"
          className="shadow-lg"
          disabled={upload.isPending}
          onClick={() => fileInput.current?.click()}
        >
          {upload.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <Plus /> Add screenshot
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

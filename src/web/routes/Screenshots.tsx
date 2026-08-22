import { useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2, LogOut, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/web/components/ui/button'
import {
  useDeleteScreenshot,
  useLogout,
  useScreenshots,
  useUpload,
} from '@/web/lib/queries'
import { useDrainOutbox } from '@/web/lib/useDrainOutbox'
import { TelegramCard } from '@/web/components/TelegramCard'
import type { PublicUser, ScreenshotDTO } from '@/shared/types'

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
    if (shared && Number(shared) > 0) setNotice(`Received ${shared} screenshot(s) from the share sheet.`)
    else if (failed === 'login-required') setNotice('Sign in first, then share again.')
    else if (failed) setNotice('That share could not be read.')
    if (shared || failed) window.history.replaceState(null, '', '/')
  }, [])
  return notice
}

function Tile({ shot }: { shot: ScreenshotDTO }) {
  const remove = useDeleteScreenshot()
  const [broken, setBroken] = useState(false)

  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card">
      <div className="aspect-[3/4] w-full bg-secondary">
        {broken ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
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
          <p className="truncate text-[11px] text-muted-foreground">
            {shot.source === 'share-target' ? 'shared' : shot.source} · {formatSize(shot.size)}
            {shot.width && shot.height ? ` · ${shot.width}×${shot.height}` : ''}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
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
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-24 pt-5">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">Screenshots</h1>
          <p className="truncate text-sm text-muted-foreground">{user.name}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => logout.mutate()}>
          <LogOut className="size-4" />
        </Button>
      </header>

      <TelegramCard user={user} />

      {notice && (
        <p className="mb-4 rounded-lg bg-primary/15 px-3 py-2 text-sm text-foreground">{notice}</p>
      )}
      {pending > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Uploading {pending} shared item(s)…
        </p>
      )}
      {upload.error && (
        <p role="alert" className="mb-4 rounded-lg bg-destructive/15 px-3 py-2 text-sm text-destructive">
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
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      ) : shots.data?.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shots.data.map((shot) => (
            <Tile key={shot.id} shot={shot} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium">No screenshots yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
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

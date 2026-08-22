import { useQueryClient } from '@tanstack/react-query'
import { Check, Send } from 'lucide-react'
import { Button } from '@/web/components/ui/button'
import { meKey, useTelegramLink, useTelegramUnlink } from '@/web/lib/queries'
import type { PublicUser } from '@/shared/types'

export function TelegramCard({ user }: { user: PublicUser }) {
  const qc = useQueryClient()
  const link = useTelegramLink()
  const unlink = useTelegramUnlink()

  if (user.telegramLinked) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Check className="size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Telegram connected</p>
            <p className="truncate text-xs text-muted-foreground">
              {user.telegramUsername ? `@${user.telegramUsername}` : 'Send screenshots to the bot'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          disabled={unlink.isPending}
          onClick={() => unlink.mutate()}
        >
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-xl border bg-card px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <Send className="size-4 shrink-0 text-primary" />
        <p className="text-sm font-medium">Connect Telegram</p>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        iOS cannot share into a web app. Send screenshots to the bot instead and they land here.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={link.isPending}
          onClick={async () => {
            const { url } = await link.mutateAsync()
            // A full navigation hands off to the Telegram app far more reliably
            // than window.open, which a standalone PWA tends to trap or block.
            window.location.href = url
          }}
        >
          {link.isPending ? 'Preparing…' : 'Connect Telegram'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => qc.invalidateQueries({ queryKey: meKey })}
        >
          Already did it
        </Button>
      </div>
      {link.error && <p className="mt-2 text-xs text-destructive">{link.error.message}</p>}
    </div>
  )
}

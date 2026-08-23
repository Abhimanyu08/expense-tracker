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
      <div className="bg-card mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Check className="text-primary size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Telegram connected</p>
            <p className="text-muted-foreground truncate text-xs">
              {user.telegramUsername ? `@${user.telegramUsername}` : 'Send screenshots to the bot'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground shrink-0"
          disabled={unlink.isPending}
          onClick={() => unlink.mutate()}
        >
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <div className="bg-card mb-4 rounded-xl border px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <Send className="text-primary size-4 shrink-0" />
        <p className="text-sm font-medium">Connect Telegram</p>
      </div>
      <p className="text-muted-foreground mt-1.5 text-xs">
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
      {link.error && <p className="text-destructive mt-2 text-xs">{link.error.message}</p>}
    </div>
  )
}

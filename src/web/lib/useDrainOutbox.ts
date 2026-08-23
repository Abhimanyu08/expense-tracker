import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from './api'
import { prepareForUpload } from './downscale'
import { outbox } from './outbox'
import { screenshotsKey } from './queries'

/* Uploads anything the service worker parked while the user was logged out or
 * offline. Runs once the session is known to be valid. */
export function useDrainOutbox(enabled: boolean) {
  const qc = useQueryClient()
  const [pending, setPending] = useState(0)
  const running = useRef(false)

  useEffect(() => {
    if (!enabled || running.current) return
    running.current = true

    void (async () => {
      try {
        const items = await outbox.all()
        setPending(items.length)
        if (!items.length) return

        let uploaded = 0
        for (const item of items) {
          try {
            const { blob, width, height } = await prepareForUpload(item.blob)
            await api.uploadScreenshot(blob, 'share-target', item.name, { width, height })
            await outbox.remove(item.id)
            uploaded++
          } catch (err) {
            // A rejected file will never succeed, so drop it rather than let it
            // block every later share. Anything else is worth retrying, so stop
            // and leave the queue intact for the next launch.
            const status = err instanceof ApiError ? err.status : 0
            if (status === 400 || status === 413 || status === 415) {
              await outbox.remove(item.id)
              continue
            }
            break
          } finally {
            setPending((n) => Math.max(0, n - 1))
          }
        }
        if (uploaded) await qc.invalidateQueries({ queryKey: screenshotsKey })
      } finally {
        setPending(0)
        running.current = false
      }
    })()
  }, [enabled, qc])

  return pending
}

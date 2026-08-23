import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { prepareForUpload } from './downscale'

export const meKey = ['me'] as const
export const screenshotsKey = ['screenshots'] as const

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api.me().then((r) => r.user),
    staleTime: 60_000,
    retry: false,
    // The Telegram link is completed in another app, so re-check on return.
    refetchOnWindowFocus: true,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ phone, password }: { phone: string; password: string }) =>
      api.login(phone, password),
    onSuccess: ({ user }) => qc.setQueryData(meKey, user),
  })
}

export function useSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ phone, name, password }: { phone: string; name: string; password: string }) =>
      api.signup(phone, name, password),
    onSuccess: ({ user }) => qc.setQueryData(meKey, user),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      qc.setQueryData(meKey, null)
      qc.removeQueries({ queryKey: screenshotsKey })
    },
  })
}

export function useScreenshots(enabled: boolean) {
  return useQuery({
    queryKey: screenshotsKey,
    queryFn: () => api.listScreenshots().then((r) => r.screenshots),
    enabled,
    refetchOnWindowFocus: true,
    /* Parsing finishes on a queue consumer, which has no way to tell the page.
     * Poll, but only while something is actually in flight -- an idle list
     * should not be hitting the API every few seconds forever. */
    refetchInterval: (query) =>
      query.state.data?.some((s) => s.parseStatus === 'pending' || s.parseStatus === 'processing')
        ? 2_000
        : false,
  })
}

export function useUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (files: File[]) =>
      Promise.all(
        files.map(async (f) => {
          const { blob, width, height } = await prepareForUpload(f)
          return api.uploadScreenshot(blob, 'upload', f.name, { width, height })
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: screenshotsKey }),
  })
}

export function useTelegramLink() {
  return useMutation({ mutationFn: () => api.telegramLink() })
}

export function useTelegramUnlink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.telegramUnlink(),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  })
}

export function useDeleteScreenshot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteScreenshot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: screenshotsKey }),
  })
}

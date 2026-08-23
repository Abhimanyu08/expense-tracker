import type { PublicUser, ScreenshotDTO, TelegramLink } from '@/shared/types'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  const body = isJson ? ((await res.json()) as Record<string, unknown>) : null

  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
    throw new ApiError(message, res.status)
  }
  return body as T
}

const json = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
})

export const api = {
  me: () => request<{ user: PublicUser | null }>('/api/auth/me'),

  login: (phone: string, password: string) =>
    request<{ user: PublicUser }>('/api/auth/login', json({ phone, password })),

  signup: (phone: string, name: string, password: string) =>
    request<{ user: PublicUser }>('/api/auth/signup', json({ phone, name, password })),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  listScreenshots: () => request<{ screenshots: ScreenshotDTO[] }>('/api/screenshots'),

  uploadScreenshot: (file: Blob, source: 'upload' | 'share-target', filename = 'screenshot') => {
    const form = new FormData()
    form.append('image', file, filename)
    form.append('source', source)
    return request<{ screenshot: ScreenshotDTO }>('/api/screenshots', {
      method: 'POST',
      body: form,
    })
  },

  deleteScreenshot: (id: string) =>
    request<{ ok: true }>(`/api/screenshots/${id}`, { method: 'DELETE' }),

  telegramLink: () => request<TelegramLink>('/api/telegram/link-token', { method: 'POST' }),

  telegramUnlink: () => request<{ ok: true }>('/api/telegram/unlink', { method: 'POST' }),
}

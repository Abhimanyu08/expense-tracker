const API = 'https://api.telegram.org'

export type TgFrom = { id: number; username?: string; first_name?: string }
export type TgPhotoSize = {
  file_id: string
  width: number
  height: number
  file_size?: number
}
export type TgDocument = {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}
export type TgMessage = {
  message_id: number
  from?: TgFrom
  chat: { id: number; type: string }
  text?: string
  caption?: string
  photo?: TgPhotoSize[]
  document?: TgDocument
  media_group_id?: string
}
export type TgUpdate = { update_id: number; message?: TgMessage }

/** Bots can only pull files up to 20 MB through getFile. */
export const TG_MAX_DOWNLOAD = 20 * 1024 * 1024

export class Telegram {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, payload: unknown = {}): Promise<T> {
    const res = await fetch(`${API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json()) as { ok: boolean; result?: T; description?: string }
    if (!body.ok) throw new Error(`telegram ${method}: ${body.description ?? res.status}`)
    return body.result as T
  }

  sendMessage(chatId: number, text: string) {
    return this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
    })
  }

  /** Best-effort: an album's later photos may race the first one's reply. */
  async editMessageText(chatId: number, messageId: number, text: string): Promise<void> {
    try {
      await this.call('editMessageText', { chat_id: chatId, message_id: messageId, text })
    } catch {
      // "message is not modified" and similar are not worth failing an ingest over.
    }
  }

  async download(fileId: string): Promise<{ bytes: ArrayBuffer; path: string }> {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', {
      file_id: fileId,
    })
    if (!file.file_path) throw new Error('telegram getFile returned no path')
    const res = await fetch(`${API}/file/bot${this.token}/${file.file_path}`)
    if (!res.ok) throw new Error(`telegram file download failed: ${res.status}`)
    return { bytes: await res.arrayBuffer(), path: file.file_path }
  }

  setWebhook(url: string, secret: string) {
    return this.call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    })
  }
}

const EXT_TO_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
}

/** Telegram serves a path like "photos/file_42.jpg" and no content type. */
export function typeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_TYPE[ext] ?? 'application/octet-stream'
}

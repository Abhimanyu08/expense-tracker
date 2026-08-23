export type PublicUser = {
  id: string
  name: string
  phone: string
  telegramLinked: boolean
  telegramUsername: string | null
}

export type ParseStatus = 'pending' | 'processing' | 'done' | 'failed'

export type ScreenshotDTO = {
  id: string
  source: 'upload' | 'share-target' | 'telegram'
  contentType: string
  size: number
  createdAt: number
  width: number | null
  height: number | null
  parseStatus: ParseStatus
  imageUrl: string
}

export type TelegramLink = {
  url: string
  expiresAt: number
}

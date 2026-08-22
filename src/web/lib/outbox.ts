export type OutboxItem = {
  id: number
  blob: Blob
  name: string
  type: string
  size: number
  receivedAt: number
}

type OutboxApi = {
  add(record: Omit<OutboxItem, 'id'>): Promise<number>
  all(): Promise<OutboxItem[]>
  remove(id: number): Promise<void>
}

declare global {
  interface Window {
    Outbox: OutboxApi
  }
}

/** Backed by public/outbox.js, which the service worker shares via importScripts. */
export const outbox: OutboxApi = {
  add: (record) => window.Outbox.add(record),
  all: () => window.Outbox.all(),
  remove: (id) => window.Outbox.remove(id),
}

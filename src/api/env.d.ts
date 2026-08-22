// Secrets and vars are not part of the generated worker-configuration.d.ts,
// so they are declared here and merged into the same global Env interface.
declare global {
  interface Env {
    TELEGRAM_BOT_TOKEN: string
    TELEGRAM_WEBHOOK_SECRET: string
    TELEGRAM_BOT_USERNAME: string
  }
}

export {}
